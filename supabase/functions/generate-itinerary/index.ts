import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDateContext,
  buildDurationContext,
  buildSharedQuerySpecs,
  buildThemeQuerySpec,
  formatResearchContext,
  getBudgetLabel,
  getFlightBudget,
  resolveDestinations,
  runQuerySpecs,
  type ResearchBundle,
} from "../_shared/research.ts";
// deploy-v3

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Service-role client for persisting job results. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected into every edge function by Supabase.
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// Input validation schemas
const PreferencesSchema = z.object({
  media: z.array(z.object({
    type: z.enum(['image', 'video']),
    preview: z.string().max(10000).optional(),
    url: z.string().max(1000).optional(), // Public URL from storage
    name: z.string().max(200).optional(),
  })).max(10).default([]),
  cities: z.array(z.string().max(100)).max(20).default([]),
  budgetAccommodation: z.number().min(0).max(100).default(50),
  budgetFlight: z.number().min(0).max(100).default(50),
  dateFlexibility: z.string().max(50).default('anytime'),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  flexibleDays: z.number().min(1).max(14).optional(), // ± days flexibility when using exact dates
  targetMonth: z.string().max(50).default(''),
  durationFlexibility: z.string().max(50).default('1-week'),
  durationDays: z.number().min(1).max(90).default(7),
  noFlight: z.boolean().default(false),
  departureCity: z.string().max(100).default(''),
  flightDirectness: z.string().max(50).default('short-layover'),
  atmosphere: z.array(z.string().max(50)).max(10).default([]),
  adventureLevel: z.string().max(50).default('active'),
  guidedPreference: z.string().max(50).default('some-guided'),
  foodDrink: z.array(z.string().max(50)).max(10).default([]),
  interests: z.array(z.string().max(50)).max(20).default([]),
  additionalNotes: z.string().max(5000).default(''),
});

const ThemeVariantSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  emoji: z.string().max(10),
}).optional();

const RequestSchema = z.object({
  preferences: PreferencesSchema,
  themeVariant: ThemeVariantSchema,
  // Optional: when provided, the finished itinerary is persisted so a
  // backgrounded/reloaded tab can reconnect and fetch the completed result.
  jobId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  // Points at research-trip's shared payload for this batch. Optional so the
  // function still works standalone, doing its own research pass.
  researchId: z.string().uuid().optional(),
});


// Helper to format dates for booking URLs
function formatDateForBooking(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  } catch {
    return '';
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Tracked outside the try so the catch below can mark a registered job failed
  // rather than leaving it pending for reconnecting clients to poll.
  let registeredJobId: string | undefined;

  // Phase timings. Generation is slow and we have been guessing at which stage
  // owns the wall clock; every phase below reports its own duration so a single
  // log line per request tells us where the time actually goes.
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const since = (start: number) => Date.now() - start;
  const timePhase = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = since(start);
      console.log(`[timing] ${name}: ${timings[name]}ms`);
    }
  };

  try {

    // Parse and validate input
    const body = await req.json();
    const validationResult = RequestSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { preferences, themeVariant, jobId, batchId, researchId } = validationResult.data;
    registeredJobId = jobId;

    console.log("Received preferences:", JSON.stringify(preferences, null, 2));
    console.log("Theme variant:", themeVariant || "default");

    // Register the job as pending so a reconnecting client can poll its status.
    if (jobId) {
      const { error: jobError } = await supabaseAdmin.from("itinerary_jobs").upsert({
        id: jobId,
        batch_id: batchId ?? jobId,
        theme_id: themeVariant?.id ?? null,
        theme_name: themeVariant?.name ?? null,
        theme_emoji: themeVariant?.emoji ?? null,
        status: "pending",
        content: null,
        error: null,
        updated_at: new Date().toISOString(),
      });
      if (jobError) console.error("Failed to register itinerary job:", jobError);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    
    // Grounded research is not optional: the system prompt tells Claude that
    // everything it names comes from live search, so generating without it
    // produces a confidently-sourced itinerary built entirely on model priors.
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      throw new Error("PERPLEXITY_API_KEY is not configured");
    }

    const {
      media,
      cities,
      budgetAccommodation,
      budgetFlight,
      dateFlexibility,
      startDate,
      endDate,
      flexibleDays,
      targetMonth,
      durationFlexibility,
      durationDays,
      noFlight,
      departureCity,
      flightDirectness,
      atmosphere,
      adventureLevel,
      guidedPreference,
      foodDrink,
      interests,
      additionalNotes,
    } = preferences;

    const budgetInfo = getBudgetLabel(budgetAccommodation);
    const flightBudget = getFlightBudget(budgetFlight);
    const durationContext = buildDurationContext(preferences);
    const dateContext = buildDateContext(preferences);

    // Build vibe context
    const guidedLabels: Record<string, string> = {
      'fully-guided': 'Prefer guided tours and organized activities',
      'some-guided': 'Mix of guided activities and self-exploration',
      'self-guided': 'Self-guided only - no guided tours, DIY everything'
    };
    const guidedLabel = guidedLabels[guidedPreference as string] || 'No preference';

    // Theme variant context
    let themeContext = "";
    if (themeVariant && typeof themeVariant === 'object' && themeVariant.name) {
      themeContext = `## ${themeVariant.emoji || "🌟"} THEME: ${themeVariant.name.toUpperCase()}
This itinerary MUST embody the "${themeVariant.name}" theme throughout.
- Every activity, restaurant, and experience should reinforce this theme
- Make bold choices that fit this specific angle on the trip
- This theme should make this itinerary feel DISTINCTLY different from other possible versions
- The theme should influence: which neighborhoods to visit, which activities to prioritize, dining choices, timing of activities, and overall vibe`;
    }

    // ============================================
    // SHARED RESEARCH
    // research-trip ran the destination resolution and every non-theme query
    // once for this batch; load it rather than repeating that work per variant.
    // ============================================
    type SharedResearch = {
      destinations: string[];
      destinationWasResolved: boolean;
      research: ResearchBundle;
    };
    let sharedResearch: SharedResearch | null = null;

    if (researchId) {
      const { data: researchRow, error: researchError } = await supabaseAdmin
        .from("trip_research")
        .select("destinations, destination_was_resolved, research")
        .eq("id", researchId)
        .maybeSingle();

      if (researchError || !researchRow) {
        // Fall back to researching locally rather than failing the itinerary.
        console.error("Could not load shared research, falling back to a local pass:", researchError);
      } else {
        sharedResearch = {
          destinations: researchRow.destinations ?? [],
          destinationWasResolved: researchRow.destination_was_resolved ?? false,
          research: (researchRow.research ?? {}) as ResearchBundle,
        };
      }
    }

    // ============================================
    // DESTINATION RESOLUTION
    // Skipped when research-trip already resolved it for this batch, so every
    // variant of one trip plans for the same place.
    // ============================================
    let resolvedCities: string[] = [...(cities ?? [])];
    let destinationWasResolved = false;

    if (sharedResearch) {
      resolvedCities = sharedResearch.destinations;
      destinationWasResolved = sharedResearch.destinationWasResolved;
      console.log("Using destinations from shared research:", resolvedCities);
    } else {
      const resolution = await timePhase("destination_resolution", () => resolveDestinations({
        cities: cities ?? [],
        additionalNotes,
        atmosphere,
        interests,
        adventureLevel,
        foodDrink,
        budgetInfo,
        flightBudget,
        noFlight,
        departureCity,
        dateContext,
        durationContext,
      }, ANTHROPIC_API_KEY));
      resolvedCities = resolution.cities;
      destinationWasResolved = resolution.wasResolved;
    }

    // Build inspiration context
    let inspirationContext = "";
    if (resolvedCities.length > 0) {
      inspirationContext = destinationWasResolved
        ? `${resolvedCities.join(", ")} (suggested based on your preferences)`
        : resolvedCities.join(", ");
    }
    if (media?.length > 0) {
      inspirationContext += inspirationContext ? ` (plus ${media.length} inspiration image(s))` : `${media.length} inspiration image(s)`;
    }

    console.log("Cities from preferences:", cities);
    console.log("Resolved cities:", resolvedCities);
    console.log("Inspiration context:", inspirationContext);

    // Build flight context
    let flightContext = "";
    if (noFlight) {
      flightContext = "- **NO FLIGHT NEEDED**: Skip all flight-related content. This is a local/road trip or the traveler is arranging their own transportation.";
    } else {
      flightContext = `- Budget (Flights): ${flightBudget} round trip
- Flight preference: ${flightDirectness === "nonstop" ? "Nonstop preferred" : flightDirectness === "short-layover" ? "Short layovers OK" : "All options including long layovers"}
${departureCity ? `- Departing from: ${departureCity}` : ""}`;
    }

    const userInputsBlock = `
**INSPIRATION (destinations)**: ${inspirationContext || "No specific destinations — use preferences to guide choice"}
${destinationWasResolved
  ? "**Note: Destination was AI-suggested from the user's preferences. You may refine or replace it if a better fit exists, but stay consistent with the spirit of the request.**"
  : "**Note: The destinations listed above MUST be included in the itinerary. You may also suggest additional nearby destinations if appropriate for the trip duration and interests.**"
}

**LOGISTICS**:
- Budget (Accommodation): ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total daily)
${flightContext}
- Date flexibility: ${dateContext}
- Duration: ${durationContext}

**VIBE**:
- Atmosphere: ${atmosphere?.length > 0 ? atmosphere.join(", ") : "No preference"}
- Adventure level: ${adventureLevel || "No preference"}
- Guided vs self-serve: ${guidedLabel}
- Food & drink: ${foodDrink?.length > 0 ? foodDrink.join(", ") : "No preference"}
- Interests (ranked): ${interests?.length > 0 ? interests.join(" > ") : "No preference"}

**OPEN TEXT / ADDITIONAL NOTES**:
${additionalNotes || "None provided"}
`;

    // ============================================
    // PERPLEXITY WEB SEARCH FOR GROUNDED RESEARCH
    // Only the activities query depends on the theme, so that is all this
    // invocation runs when research-trip already did the shared work.
    // ============================================
    const queryContext = {
      resolvedCities,
      interests,
      foodDrink,
      additionalNotes,
      budgetInfo,
      durationDays,
      startDate,
      endDate,
      targetMonth,
      noFlight,
      departureCity,
    };

    const specs = [
      buildThemeQuerySpec(queryContext, themeVariant?.name ?? ''),
      ...(sharedResearch ? [] : buildSharedQuerySpecs(queryContext)),
    ];

    const freshResearch = await timePhase("perplexity_research", () =>
      runQuerySpecs(specs, PERPLEXITY_API_KEY));
    const research: ResearchBundle = { ...(sharedResearch?.research ?? {}), ...freshResearch };

    // Individual queries can come back empty, but if every one did then the
    // grounding failed and anything generated would be pure invention.
    if (Object.values(research).every(r => !r?.content)) {
      throw new Error("Grounded research returned no content for any query");
    }

    console.log("Grounded research ready. Building context...");
    const groundedResearchContext = formatResearchContext(research, budgetInfo);

    const systemPrompt = `You are an expert travel planning AI assistant. Your task is to create comprehensive, well-researched travel itineraries with cited sources for every recommendation.

${themeContext ? themeContext + "\n\n" : ""}

## Understanding the User Inputs

The user inputs are organized into four main categories:

**1. Inspiration** - The destinations the user wants to visit
- Include all of these destinations in your itinerary unless logistically impossible
- If you must skip any destination, clearly explain why

**2. Logistics** - Practical constraints
- Budget: These are firm constraints. Stay within them or explain necessary tradeoffs
- Date flexibility: This determines flight pricing options and seasonal considerations
- Duration preferences: This guides the scope of your itinerary
- Flight preferences: These affect total travel time and cost

**3. Vibe** - Preferences that shape the experience
- Atmosphere choices: These determine the types of destinations and activities within each location
- Adventure level: This affects activity selection
- Food & drink preferences: These guide restaurant recommendations
- Interests ranking: Use this to prioritize when making choices between competing options
- Self-serve appetite: This determines whether to suggest guided tours or independent exploration
- Note: Neighborhood exploration, wandering, and unstructured discovery time are legitimate activities - not every time slot needs a specific attraction

**4. Open Text** - Additional context
- This may clarify, override, or add nuance to the structured inputs above
- Pay close attention to any specific requests or concerns mentioned here

## Research Requirements

Use the grounded research data below to find real establishment names, accurate prices, and working URLs. For every activity, hotel, restaurant, and booking link, use URLs from the research — falling back to the search URL patterns if a direct URL is not available. Do not invent establishment names or fabricate URLs.

## GROUNDED RESEARCH (CRITICAL - READ BEFORE PROCEEDING)

You have been provided with LIVE WEB SEARCH RESULTS at the start of the user message below. This is your FACTUAL GROUND TRUTH from real travel blogs, guides, and booking sites.

**STRICT RULES - YOU MUST FOLLOW THESE:**

1. **ONLY recommend activities, tours, restaurants, and hotels that appear in the grounded research data**
2. **Use the URLs and citations provided in the research** - Do NOT make up URLs
3. **Do NOT introduce new facts** beyond what is provided in the research
4. **Do NOT hallucinate establishment names** that don't appear in the research
5. **When citing sources**, use the actual URLs from the research citations
6. **For restaurants near activities**, use Google Maps search URLs for the neighborhood:
   - Format: https://www.google.com/maps/search/?api=1&query=restaurants+near+NEIGHBORHOOD+CITY
7. **The only name you may use that the research did not surface is a place already in this itinerary** — the hut, lodge, or hotel the traveler is booked into that night, when they eat there because nothing else is within reach. Naming that stay's own dining room is grounded; inventing a nearby restaurant is not.
8. **If the research is thin for part of the trip, say less rather than more.** Fewer, sourced recommendations beat a full-looking day built on invention. Note the gap in summary.assumptions.

**If something specific isn't in the research, use these SEARCH URL patterns as fallback:**
- Places: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY
- Tours: https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY
- Hotels: https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY${startDate ? `&checkin=${formatDateForBooking(startDate)}` : ''}${endDate ? `&checkout=${formatDateForBooking(endDate)}` : ''}
- Flights: https://www.google.com/travel/flights?q=flights+from+${departureCity ? departureCity.replace(/\s+/g, '+') : 'ORIGIN'}+to+DESTINATION${startDate ? `+departing+${formatDateForBooking(startDate)}` : ''}${endDate ? `+returning+${formatDateForBooking(endDate)}` : ''}

## Output Format — JSON Only

Output ONLY a single valid JSON object. No markdown, no prose, no code fences — raw JSON starting with \`{\` and ending with \`}\`.

Use this exact schema. Every field shown is required unless marked optional. All string values must be plain text (no markdown asterisks, no HTML).

\`\`\`
{
  "summary": {
    "destination": "e.g. Azores, Portugal",
    "duration": "e.g. 5 days",
    "recommendedDates": "e.g. May–September",
    "totalBudget": "e.g. $1,265–$1,780",
    "highlights": ["Top experience 1", "Top experience 2", "Top experience 3"],
    "assumptions": ["Assumption 1"],
    "bestTimeNote": "Best in May or October for fewer crowds and pleasant weather.",
    "vibeSummary": "Volcanic coastlines, thermal springs, and slow island mornings at an easy pace."
  },
  "budget": {
    "items": [
      { "category": "Flights", "range": "$400–$580", "description": "Round trip · per person · NYC → PDL" },
      { "category": "Accommodation", "range": "$325–$450", "description": "5 nights at $65–$90 / night" },
      { "category": "Activities", "range": "$100–$165", "description": "Whale watching, hiking tours, thermal pools" },
      { "category": "Food & Dining", "range": "$175–$250", "description": "≈ $35–$50 / day for two" },
      { "category": "Transportation", "range": "$150–$200", "description": "Rental car + fuel, 5 days" },
      { "category": "Contingency", "range": "$75", "description": "Buffer for the unexpected" }
    ],
    "total": "$1,265–$1,780"
  },
  "flights": {
    "skip": false,
    "context": "Round-trip from New York to Ponta Delgada (PDL) · typical 1–2 stops · ~10–12h door to gate.",
    "options": [
      {
        "description": "JFK to PDL via Lisbon — TAP Air Portugal, approx 10h total",
        "price": "$420",
        "url": "https://www.google.com/travel/flights?q=...",
        "airlineCode": "TP",
        "route": "JFK → PDL",
        "viaCity": "Lisbon",
        "airline": "TAP Air Portugal",
        "stops": "1 stop",
        "duration": "10h 30m",
        "departureTime": "7:15 PM",
        "badge": "Best value"
      }
    ]
  },
  "accommodation": [
    {
      "location": "Ponta Delgada",
      "nights": 5,
      "options": [
        {
          "name": "Hotel Name",
          "type": "Hotel",
          "pricePerNight": "$65–$90",
          "why": "Central location, walking distance to restaurants",
          "url": "https://www.booking.com/searchresults.html?ss=Hotel+Name+City",
          "isPrimary": true
        },
        {
          "name": "Budget Alternative",
          "type": "Guesthouse",
          "pricePerNight": "$45–$65",
          "why": "More affordable, good reviews",
          "url": "https://www.booking.com/searchresults.html?ss=Budget+Alternative+City",
          "isPrimary": false
        }
      ]
    }
  ],
  "bookingChecklist": [
    {
      "item": "Flights (JFK to PDL)",
      "leadTime": "Book 3–4 months in advance",
      "estimatedCost": "$350–$600",
      "url": "https://www.google.com/travel/flights?q=...",
      "priority": "high"
    },
    {
      "item": "Rental Car at PDL Airport",
      "leadTime": "Book 4–6 weeks in advance",
      "estimatedCost": "$150–$200 for 5 days",
      "url": "https://www.rentalcars.com/en/airport/sjz/",
      "priority": "high"
    }
  ],
  "days": [
    {
      "dayNumber": 1,
      "title": "Arrival and Ponta Delgada",
      "location": "Ponta Delgada",
      "transitNote": "Pick up rental car at PDL Airport",
      "periods": [
        {
          "label": "Morning",
          "activities": [
            {
              "name": "Arrive at PDL Airport",
              "description": "Clear customs and pick up your rental car; city center is 20 minutes away.",
              "duration": "2 hours",
              "cost": "Free",
              "tags": ["transit"]
            },
            {
              "name": "Check in and explore PDL",
              "description": "Drop bags, grab a coffee, and wander the black-and-white mosaic streets near your hotel.",
              "duration": "1.5 hours",
              "cost": "Free",
              "tags": ["walking", "cultural"]
            }
          ],
          "dining": [
            {
              "name": "Café do Mar",
              "description": "Sunny terrace café with fresh pastries, local cheese toasts, and strong Azorean coffee.",
              "priceRange": "$5–$10/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Cafe+do+Mar+Ponta+Delgada",
              "isPrimary": true
            },
            {
              "name": "Pastelaria Garrett",
              "description": "Classic Portuguese pastelaria with espresso, pastéis de nata, and fresh sandwiches.",
              "priceRange": "$4–$8/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Pastelaria+Garrett+Ponta+Delgada",
              "isPrimary": false
            }
          ]
        },
        {
          "label": "Afternoon",
          "activities": [
            {
              "name": "Portas da Cidade and main square",
              "description": "Walk through the iconic city gates and admire the baroque church facade on the main square.",
              "duration": "1.5 hours",
              "cost": "Free",
              "tags": ["cultural", "photo-worthy"]
            },
            {
              "name": "Mercado da Graça market",
              "description": "Browse local produce, cheeses, and Azorean crafts at this lively covered market.",
              "duration": "1 hour",
              "cost": "Free",
              "tags": ["cultural", "food"]
            }
          ],
          "dining": [
            {
              "name": "Restaurante A Tasca",
              "description": "Traditional Azorean alcatra stew and fresh tuna in a cozy family-run spot.",
              "priceRange": "$15–$25/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Restaurante+A+Tasca+Ponta+Delgada",
              "isPrimary": true
            },
            {
              "name": "Mercado da Graça food stalls",
              "description": "Casual lunch at the market — local cheeses, smoked meats, and fresh bread.",
              "priceRange": "$8–$14/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Mercado+da+Graca+Ponta+Delgada",
              "isPrimary": false
            }
          ]
        },
        {
          "label": "Evening",
          "activities": [
            {
              "name": "Sunset at PDL marina",
              "description": "Watch the sun set over the Atlantic from the marina boardwalk — stunning on clear evenings.",
              "duration": "1 hour",
              "cost": "Free",
              "tags": ["nature", "photo-worthy"]
            },
            {
              "name": "Evening stroll, Rua de Lisboa",
              "description": "Explore the pedestrian shopping street lined with cafes and local boutiques.",
              "duration": "45 minutes",
              "cost": "Free",
              "tags": ["walking", "shopping"]
            }
          ],
          "dining": [
            {
              "name": "Tony's Restaurant",
              "description": "Beloved local seafood spot known for the freshest fish on the island.",
              "priceRange": "$20–$35/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Tonys+restaurant+Ponta+Delgada",
              "isPrimary": true
            },
            {
              "name": "Restaurante Muchacho",
              "description": "Laid-back bistro with grilled catch-of-the-day and good local wine selection.",
              "priceRange": "$18–$30/person",
              "url": "https://www.google.com/maps/search/?api=1&query=Restaurante+Muchacho+Ponta+Delgada",
              "isPrimary": false
            }
          ]
        }
      ]
    }
  ],
  "alternatives": [
    {
      "title": "Add a Day Trip to Flores Island",
      "description": "Flores has the most dramatic scenery in the Azores — waterfalls, crater lakes, hydrangeas.",
      "url": "https://www.google.com/search?q=Flores+island+Azores+day+trip"
    }
  ]
}
\`\`\`

STRICT RULES:
- Output ONLY the JSON object — nothing before or after it
- No markdown code fences in the actual output — the above \`\`\` are just for illustration
- Every day must have exactly 3 periods: Morning, Afternoon, Evening
- Each period must have EXACTLY 2 activities (no more, no fewer)
- Include 1 or 2 dining options for every period: Morning (breakfast), Afternoon (lunch), Evening (dinner). The first must have "isPrimary": true (top pick); include a second with "isPrimary": false ONLY when a real, separate alternative exists within reach of where the traveler actually is at that hour. One real option beats two where the second is filler.
- NEVER INVENT A RESTAURANT TO FILL A SLOT. Every name must come from the grounded research or be the place the traveler is already staying that day. If the research offers nothing for a location, give one option — the lodging's own kitchen — rather than a second name you cannot source. A slot with one sourced option is correct; a slot with an invented second option is a failure.
- WHERE MEALS ARE INCLUDED, SAY SO INSTEAD OF INVENTING CHOICE. When a stay includes meals or has no alternative nearby — a mountain hut or refuge on half board, a lodge, a ryokan, a safari camp, an all-inclusive, a boat, a remote village — the correct answer is that establishment. The same establishment MAY serve dinner and the next morning's breakfast; state that it is the hut/lodge's own dining room and what the meal plan covers.
- OTHERWISE VARY THE RESTAURANTS: in towns and cities, where the traveler has real choice, do not repeat an establishment across periods or days — branch into nearby neighborhoods for fresh options. Repetition is only correct when it reflects where the traveler actually is, never when it is padding.
- ONLY recommend restaurants confirmed to be currently open in the grounded research. If the research mentions any closure, "permanently closed", "temporarily closed", or uncertain status for an establishment, do NOT include it. When in doubt, prefer well-established restaurants with multiple recent reviews over newer or less-cited spots.
- MATCH THE MEAL TO THE PERIOD: Morning dining must be breakfast spots (cafés, bakeries, brunch, or the included hut/hotel breakfast). Afternoon must be lunch spots. Evening must be dinner. Do not put a dinner restaurant in a morning slot.
- VARY THE PRIMARY PICKS BY DAY where the destination offers a choice: the "isPrimary": true option should feel distinct day-to-day in cuisine, vibe, and neighborhood — showcase the destination's range, don't anchor every day to the same kind of place.
- Tags must only be from: transit, cultural, nature, hiking, beach, food, photo-worthy, walking, adventure, relaxation, shopping, nightlife
- priority must be exactly "high", "medium", or "low"
- Use real URLs from the grounded research — fallback to search URL patterns listed above
- Keep ALL descriptions to 1 short sentence (25 words maximum) — be ruthlessly concise
- Keep activity names under 6 words
- Omit bookingUrl entirely if it would be an empty string
- If noFlight is true, set flights.skip to true and flights.options to []
- Always populate summary.bestTimeNote with 1 sentence about the best time to visit and why
- Always populate summary.vibeSummary with ONE short evocative sentence (10-16 words) capturing the trip's overall vibe and pace — e.g. "Old towns, sea-captains' palaces, island churches, and centuries of maritime history." No destination name, no markdown.
- Always populate flights.context with a summary of the routing (e.g. "Round-trip from City to Destination (IATA) · N stops · ~Xh door to gate.")
- Always populate all structured flight fields: airlineCode, route, viaCity, airline, stops, duration, departureTime. Set badge to "Best value", "Fastest", or omit for others.
- Always populate budget items with a description field explaining what the cost covers

## Guidelines

- Stay within budget or clearly explain tradeoffs
- Always include destinations from the user's inspiration
- When the destination is a region rather than a single city, plan across it — move between its towns and valleys as the trip requires, and do not collapse the itinerary into the gateway city
- Turn the planning research into action: anything with a booking window, permit, reservation, access restriction, or equipment/guiding requirement belongs in bookingChecklist with its real lead time, and any constraint the traveler must accept belongs in summary.assumptions
- Match adventure level and vibe throughout
- For trips with few destinations and long duration, suggest nearby additions
- Prioritize by the user's interests ranking
- Include real, actionable URLs from the research above

Output ONLY the JSON object. No text before or after it.`;

    const userPrompt = `Here are my travel planning inputs:

<user_inputs>
${userInputsBlock}
</user_inputs>

Create a comprehensive, well-researched travel itinerary based on these preferences. Be opinionated and specific - tell me exactly what I should do.`;

    // Build the single user turn. The grounded research goes inside it rather
    // than in an assistant message of its own: the Anthropic Messages API
    // requires the first message to use the "user" role, so an assistant-first
    // array is rejected with a 400 before any generation happens.
    const userContent: any[] = [];

    if (groundedResearchContext) {
      userContent.push({ type: "text", text: groundedResearchContext });
      console.log("Injected grounded research context into the user message");
    }

    userContent.push({ type: "text", text: userPrompt });

    // Media (images/videos) - use public URLs from storage. Anthropic takes an
    // image block with a `source`; `image_url` is the OpenAI shape and 400s here.
    const mediaWithUrls = media?.filter(item => item.url && item.type === 'image') || [];

    for (const item of mediaWithUrls) {
      if (item.url) {
        userContent.push({
          type: "image",
          source: { type: "url", url: item.url },
        });
      }
    }
    if (mediaWithUrls.length > 0) {
      console.log(`Attached ${mediaWithUrls.length} image(s) to the request`);
    }

    console.log("Calling Anthropic API");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // The system prompt is a top-level field, not a message. It is ~4k
        // tokens and byte-identical on every request, for every trip, so mark it
        // cacheable: subsequent generations skip re-processing it and start
        // streaming sooner. Everything trip-specific (the grounded research, the
        // prompt, the images) lives in the user turn after this breakpoint, so
        // it never invalidates the cached prefix.
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
        max_tokens: 32000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);

      // Mark the job failed. It was registered as pending before this call, and
      // a client that reconnects to it would otherwise poll a job that can never
      // complete until its own timeout expires.
      if (jobId) {
        await supabaseAdmin.from("itinerary_jobs").update({
          status: "error",
          error: `Anthropic API ${response.status}: ${errorText}`.slice(0, 2000),
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      }

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Failed to generate itinerary. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Transform Anthropic SSE format → OpenAI SSE format (frontend expects OpenAI spec)
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // The pump accumulates the full itinerary, forwards deltas to the client
    // (best-effort — the tab may be gone), and persists the final result. It is
    // registered with EdgeRuntime.waitUntil so it runs to completion and saves
    // even after the client disconnects (e.g. a mobile tab is discarded).
    const pump = (async () => {
      const reader = response.body!.getReader();
      let buffer = "";
      let fullContent = "";
      let clientConnected = true;
      // Diagnostics for the truncation we keep seeing. `stop_reason` is the
      // decisive signal: "max_tokens" means the model genuinely ran out of the
      // 32k output budget, while an absent stop_reason means the stream died
      // before the model finished — a killed function or a dropped connection,
      // which is a different problem with a different fix.
      const modelStart = Date.now();
      let firstTokenMs: number | null = null;
      let stopReason: string | null = null;
      let outputTokens: number | null = null;

      // Forward to the client only while it's still connected; once a write
      // fails the tab is gone, so we stop forwarding but keep accumulating.
      const forward = async (chunk: string) => {
        if (!clientConnected) return;
        try {
          await writer.write(encoder.encode(chunk));
        } catch {
          clientConnected = false;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              await forward("data: [DONE]\n\n");
              continue;
            }
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                if (firstTokenMs === null) {
                  firstTokenMs = Date.now() - modelStart;
                  console.log(`[timing] model_ttft: ${firstTokenMs}ms`);
                }
                fullContent += event.delta.text;
                const openAiChunk = JSON.stringify({ choices: [{ delta: { content: event.delta.text } }] });
                await forward(`data: ${openAiChunk}\n\n`);
              }
              // Carries the terminal stop_reason and the final output token count.
              if (event.type === "message_delta") {
                stopReason = event.delta?.stop_reason ?? stopReason;
                outputTokens = event.usage?.output_tokens ?? outputTokens;
              }
              // Confirms the system-prompt cache is actually being hit. If
              // cache_read stays at 0 across generations, something upstream of
              // the breakpoint is changing between requests.
              if (event.type === "message_start") {
                const u = event.message?.usage;
                if (u) {
                  console.log(`[timing] cache: read=${u.cache_read_input_tokens ?? 0} write=${u.cache_creation_input_tokens ?? 0} uncached_input=${u.input_tokens ?? 0}`);
                }
              }
            } catch { /* skip malformed lines */ }
          }
        }
        await forward("data: [DONE]\n\n");

        timings.model_generation = Date.now() - modelStart;
        timings.total = since(t0);
        console.log("[timing] summary " + JSON.stringify({
          ...timings,
          model_ttft: firstTokenMs,
          stop_reason: stopReason,
          output_tokens: outputTokens,
          output_chars: fullContent.length,
          theme: themeVariant?.id ?? "default",
          client_disconnected: !clientConnected,
        }));
        // `end_turn` is the only clean finish. Anything else means the itinerary
        // the client renders is incomplete, so say so loudly rather than
        // persisting a truncated result that looks successful.
        if (stopReason && stopReason !== "end_turn") {
          console.error(`Generation did not finish cleanly: stop_reason=${stopReason}, output_tokens=${outputTokens}`);
        }

        // Persist the finished itinerary for reconnecting clients.
        if (jobId) {
          const { error: saveError } = await supabaseAdmin.from("itinerary_jobs").update({
            status: "complete",
            content: fullContent,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);
          if (saveError) console.error("Failed to persist itinerary result:", saveError);
        }
      } catch (streamError) {
        console.error("Streaming/persist error:", streamError);
        if (jobId) {
          await supabaseAdmin.from("itinerary_jobs").update({
            status: "error",
            error: String(streamError).slice(0, 2000),
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);
        }
      } finally {
        try { await writer.close(); } catch { /* already closed */ }
      }
    })();

    // Keep the function alive until generation + persistence finish, even if the
    // client disconnects. Guarded because EdgeRuntime is absent when running the
    // function locally — there the pump still runs within the request lifetime.
    try {
      (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
        .EdgeRuntime?.waitUntil(pump);
    } catch { /* not available — pump runs inline */ }

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Error in generate-itinerary function:", error);
    if (registeredJobId) {
      await supabaseAdmin.from("itinerary_jobs").update({
        status: "error",
        error: String(error).slice(0, 2000),
        updated_at: new Date().toISOString(),
      }).eq("id", registeredJobId);
    }
    return new Response(JSON.stringify({ error: "Unable to process request. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

