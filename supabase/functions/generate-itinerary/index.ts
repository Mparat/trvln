import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
// deploy-v3

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
});


// Helper function to call Perplexity for grounded web search
async function searchWithPerplexity(
  query: string, 
  apiKey: string
): Promise<{ content: string; citations: string[] }> {
  try {
    console.log("Perplexity search query:", query);
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: 'You are a travel research assistant. Provide specific, detailed recommendations with exact names of restaurants, hotels, tours, and activities. When researching hotels, prioritize options within the specified price range and include nightly rates. If most options exceed the budget, explicitly note this and suggest alternatives. Include price ranges when available. Be comprehensive but concise.' 
          },
          { role: 'user', content: query }
        ],
      }),
    });

    if (!response.ok) {
      console.error("Perplexity API error:", response.status);
      return { content: '', citations: [] };
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      citations: data.citations || []
    };
  } catch (error) {
    console.error("Perplexity search error:", error);
    return { content: '', citations: [] };
  }
}

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

    const { preferences, themeVariant } = validationResult.data;

    console.log("Received preferences:", JSON.stringify(preferences, null, 2));
    console.log("Theme variant:", themeVariant || "default");

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");

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

    // Build budget context
    const getBudgetLabel = (value: number) => {
      if (value <= 25) return { label: "Budget", accommodation: "$0-$50/night", daily: "$50-80/day" };
      if (value <= 50) return { label: "Moderate", accommodation: "$50-$100/night", daily: "$100-150/day" };
      if (value <= 75) return { label: "Comfortable", accommodation: "$100-$200/night", daily: "$200-300/day" };
      return { label: "Luxury", accommodation: "$200+/night", daily: "$400+/day" };
    };

    const getFlightBudget = (value: number) => {
      if (value <= 25) return "$100-$300";
      if (value <= 50) return "$300-$600";
      if (value <= 75) return "$600-$1000";
      return "$1000+";
    };

    const budgetInfo = getBudgetLabel(budgetAccommodation);
    const flightBudget = getFlightBudget(budgetFlight);

    // Build duration context
    const computeInclusiveDays = (startISO?: string, endISO?: string) => {
      if (!startISO || !endISO) return null;
      const start = new Date(startISO);
      const end = new Date(endISO);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return diffDays + 1; // inclusive
    };

    let durationContext = "";

    // If user chose exact dates, calculate base duration and apply flexibility
    if (dateFlexibility === "strict") {
      const daysFromDates = computeInclusiveDays(startDate, endDate);
      if (daysFromDates) {
        if (flexibleDays && flexibleDays > 0) {
          // User has exact dates but with ± N days flexibility
          const minDays = Math.max(1, daysFromDates - flexibleDays);
          const maxDays = daysFromDates + flexibleDays;
          durationContext = `${minDays}-${maxDays} days (base: ${daysFromDates} days, ±${flexibleDays} days flexible)`;
        } else {
          durationContext = `exactly ${daysFromDates} days`;
        }
      } else {
        durationContext = "dates provided but duration unclear";
      }
    } else {
      switch (durationFlexibility) {
        case "weekend":
          durationContext = "2-3 day weekend trip";
          break;
        case "long-weekend":
          durationContext = "4-5 day long weekend";
          break;
        case "1-week":
          durationContext = "7 day trip";
          break;
        case "2-weeks":
          durationContext = "14 day trip";
          break;
        case "strict":
          durationContext = `exactly ${durationDays} days`;
          break;
        case "flexible-days":
          durationContext = `approximately ${durationDays} days (±2 days flexible)`;
          break;
        default:
          durationContext = "flexible duration - suggest optimal length";
      }
    }

    // Build date context
    let dateContext = "";
    switch (dateFlexibility) {
      case "strict":
        if (startDate && endDate) {
          if (flexibleDays && flexibleDays > 0) {
            // Exact dates with flexibility - AI can extend trip by ± N days on either end
            dateContext = `Target dates: ${startDate} to ${endDate} (±${flexibleDays} days flexible on either end). You may start up to ${flexibleDays} days earlier or end up to ${flexibleDays} days later if it improves the trip. Choose what works best for the destination and activities.`;
          } else {
            dateContext = `Fixed dates: ${startDate} to ${endDate}`;
          }
        } else {
          dateContext = "Specific dates (not provided)";
        }
        break;
      case "flexible-days":
        dateContext = startDate ? `Around ${startDate} (±few days flexible)` : "Flexible around specific dates";
        break;
      case "month":
        dateContext = targetMonth ? `Target: ${targetMonth}` : "Specific month/season";
        break;
      default:
        dateContext = "Anytime - recommend best time to visit";
    }

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
    // DESTINATION RESOLUTION PASS
    // When no explicit city is given, ask Claude Haiku to pick the best
    // match before Perplexity runs, so all research is destination-specific.
    // ============================================
    let resolvedCities: string[] = [...(cities ?? [])];
    let destinationWasResolved = false;

    if (resolvedCities.length === 0) {
      console.log("No explicit cities — resolving destination from preferences...");
      try {
        const resolutionPrompt = `You are a travel destination expert. Based on the traveler's preferences below, choose 1-2 specific destination cities or regions that best fit. Be decisive and concrete — not "Southeast Asia" but "Chiang Mai, Thailand".

Preferences:
- What they described: ${additionalNotes || "Not specified"}
- Atmosphere: ${atmosphere?.join(", ") || "no preference"}
- Interests: ${interests?.join(", ") || "no preference"}
- Adventure level: ${adventureLevel || "active"}
- Food preferences: ${foodDrink?.join(", ") || "no preference"}
- Accommodation budget: ${budgetInfo.label} (${budgetInfo.accommodation})
- Flight budget: ${noFlight ? "no flight needed (local/ground trip)" : flightBudget + " round trip"}
- Departing from: ${departureCity || "unknown"}
- Travel timing: ${dateContext}
- Duration: ${durationContext}

Respond with ONLY a JSON array of 1-2 destination strings. Examples:
["Lisbon, Portugal"]
["Chiang Mai, Thailand", "Bangkok, Thailand"]

No explanation. Just the JSON array.`;

        const resolutionResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5",
            messages: [{ role: "user", content: resolutionPrompt }],
            max_tokens: 100,
          }),
        });

        if (resolutionResponse.ok) {
          const resolutionData = await resolutionResponse.json();
          const resolutionText = resolutionData.content?.[0]?.text?.trim() ?? "";
          // Strip any accidental code fences
          const cleaned = resolutionText.replace(/```[a-z]*\n?/gi, "").trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed) && parsed.length > 0) {
            resolvedCities = parsed.filter((d: unknown) => typeof d === "string");
            destinationWasResolved = true;
            console.log("Resolved destinations:", resolvedCities);
          }
        }
      } catch (err) {
        console.error("Destination resolution failed — proceeding without explicit cities:", err);
      }
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
    // ============================================
    let groundedResearchContext = "";
    
    if (PERPLEXITY_API_KEY) {
      console.log("Starting Perplexity grounded research...");
      
      const destinationStr = resolvedCities.length > 0 ? resolvedCities.join(', ') : 'popular travel destinations';
      const primaryCity = resolvedCities[0] || 'the destination';
      const interestsStr = interests?.length > 0 ? interests.join(', ') : 'general sightseeing';
      const foodStr = foodDrink?.length > 0 ? foodDrink.join(', ') : 'local cuisine';
      const themeStr = themeVariant?.name || '';

      // Determine trip length for context-aware queries
      const tripDaysNum = durationDays || 7;
      const isSingleCity = resolvedCities.length === 1;
      const isLongTrip = tripDaysNum >= 7;
      
      // Build focused search queries based on user preferences
      const searchQueries: string[] = [
        // Query 1: Activities and things to do
        `Best things to do in ${destinationStr} for ${interestsStr} travelers. Include specific activity names, tour recommendations, must-visit attractions, hidden gems, and neighborhoods to explore.${themeStr ? ` Focus on ${themeStr} experiences.` : ''} ${budgetInfo.label} budget level.`,

        // Query 2: Restaurants and food scene
        `Best ${foodStr} restaurants and food experiences in ${destinationStr}. Include specific restaurant names, neighborhoods known for food, price ranges, and local specialties. ${budgetInfo.label} budget.`,

        // Query 3: Accommodation with date-specific pricing
        `Best ${budgetInfo.label} hotels in ${destinationStr} priced ${budgetInfo.accommodation}. ${startDate && endDate ? `For dates: check-in ${startDate}, check-out ${endDate}.` : targetMonth ? `For travel in ${targetMonth}.` : ''} Include specific hotel names with nightly rates and neighborhoods to stay.`,

        // Query 4: Nearby destinations + transportation (combined)
        isSingleCity && isLongTrip
          ? `For a ${tripDaysNum}-day trip based in ${primaryCity}: what other cities should I visit, how to travel between them (trains, buses, flights with prices and times), and how many days to spend in each? Include day trips and overnight options.`
          : `Best day trips and nearby destinations from ${destinationStr} for a ${tripDaysNum}-day trip. Include travel time, transport options with prices, and why each is worth visiting.`,

        // Query 5: Seasonal & practical information
        `${destinationStr} travel in ${targetMonth || 'the travel season'}. Include weather, peak vs off-season pricing, festivals or events, crowd levels, and any seasonal closures.`
      ];

      // Query 6: Flight estimates (conditional)
      if (!noFlight && departureCity) {
        searchQueries.push(
          `Flights from ${departureCity} to ${primaryCity} in ${targetMonth || 'upcoming months'}. Include typical price ranges, best airlines, flight duration, and whether nonstop options exist.`
        );
      }
      
      // Run all searches in parallel for speed
      console.log(`Executing ${searchQueries.length} Perplexity research queries...`);
      const searchPromises = searchQueries.map(query => searchWithPerplexity(query, PERPLEXITY_API_KEY));
      const results = await Promise.all(searchPromises);
      
      console.log("Perplexity research completed. Building grounded context...");
      
      // Build the grounded context block
      const activitiesResearch = results[0];
      const restaurantsResearch = results[1];
      const accommodationResearch = results[2];
      const nearbyAndTransportResearch = results[3];
      const seasonalResearch = results[4];
      const flightResearch = results[5]; // May be undefined if no flight query

      groundedResearchContext = `
## GROUNDED RESEARCH DATA (From Live Web Search)

**CRITICAL INSTRUCTIONS:** The following is retrieved from live web search — treat it as FACTUAL GROUNDING.
- ONLY recommend places, activities, and restaurants that appear in this research
- Do NOT hallucinate establishment names or URLs
- For anything not in the research, use the fallback URL patterns in the system prompt

---

### 🗺️ NEARBY DESTINATIONS, DAY TRIPS & TRANSPORTATION
${nearbyAndTransportResearch?.content || 'No nearby destinations/transport research available.'}

**Citations:**
${nearbyAndTransportResearch?.citations?.length > 0 ? nearbyAndTransportResearch.citations.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}

---

### 📅 SEASONAL & PRACTICAL INFORMATION
${seasonalResearch?.content || 'No seasonal research available.'}

**Citations:**
${seasonalResearch?.citations?.length > 0 ? seasonalResearch.citations.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}

---

### ✈️ FLIGHT INFORMATION
${flightResearch?.content || 'No flight research available - use Google Flights for accurate pricing.'}

**Citations:**
${flightResearch?.citations?.length > 0 ? flightResearch.citations.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}

---

### 🎯 ACTIVITIES & THINGS TO DO
${activitiesResearch.content || 'No activity research available.'}

**Citations:**
${activitiesResearch.citations?.length > 0 ? activitiesResearch.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}

---

### 🍽️ RESTAURANTS & FOOD
${restaurantsResearch.content || 'No restaurant research available.'}

**Citations:**
${restaurantsResearch.citations?.length > 0 ? restaurantsResearch.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}

---

### 🏨 ACCOMMODATION
${accommodationResearch.content || 'No accommodation research available.'}

**User's Accommodation Budget:** ${budgetInfo.accommodation}
**If prices exceed this range, note why and provide a budget alternative.**

**Citations:**
${accommodationResearch.citations?.length > 0 ? accommodationResearch.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available'}
`;
    } else {
      console.log("PERPLEXITY_API_KEY not configured - skipping grounded research");
    }

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

You have been provided with LIVE WEB SEARCH RESULTS in the assistant message below. This is your FACTUAL GROUND TRUTH from real travel blogs, guides, and booking sites.

**STRICT RULES - YOU MUST FOLLOW THESE:**

1. **ONLY recommend activities, tours, restaurants, and hotels that appear in the grounded research data**
2. **Use the URLs and citations provided in the research** - Do NOT make up URLs
3. **Do NOT introduce new facts** beyond what is provided in the research
4. **Do NOT hallucinate establishment names** that don't appear in the research
5. **When citing sources**, use the actual URLs from the research citations
6. **For restaurants near activities**, use Google Maps search URLs for the neighborhood:
   - Format: https://www.google.com/maps/search/?api=1&query=restaurants+near+NEIGHBORHOOD+CITY

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
- Include EXACTLY 2 dining options for ALL periods: Morning (breakfast), Afternoon (lunch), Evening (dinner). First must have "isPrimary": true (top pick), second must have "isPrimary": false (alternative). Both must be specific named restaurants — no generic descriptions.
- DINING MUST BE UNIQUE: Every restaurant across the ENTIRE itinerary must be a DIFFERENT establishment. NEVER repeat the same restaurant in two periods or on two different days — not as a primary and not as an alternative. For an N-day trip you will name roughly N×6 distinct restaurants; if grounded research is limited, branch into nearby neighborhoods/towns to find fresh options rather than reusing one.
- MATCH THE MEAL TO THE PERIOD: Morning dining must be breakfast spots (cafés, bakeries, brunch). Afternoon must be lunch spots. Evening must be dinner restaurants. Do not put a dinner restaurant in a morning slot.
- VARY THE PRIMARY PICKS BY DAY: The "isPrimary": true restaurant for each period should feel distinct day-to-day in cuisine, vibe, and neighborhood — showcase the destination's range across the trip, don't anchor every day to the same kind of place.
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

    // Build messages
    const messages: any[] = [{ role: "system", content: systemPrompt }];

    // Inject grounded research context as assistant message (if available)
    if (groundedResearchContext) {
      messages.push({ role: "assistant", content: groundedResearchContext });
      console.log("Injected grounded research context into messages");
    }

    // Handle media (images/videos) - use public URLs from storage
    const mediaWithUrls = media?.filter(item => item.url && item.type === 'image') || [];
    
    if (mediaWithUrls.length > 0) {
      const content: any[] = [{ type: "text", text: userPrompt }];

      for (const item of mediaWithUrls) {
        if (item.url) {
          content.push({
            type: "image_url",
            image_url: { url: item.url },
          });
        }
      }

      messages.push({ role: "user", content });
      console.log(`Attached ${mediaWithUrls.length} image(s) to the request`);
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    console.log("Calling Anthropic API");

    // Extract system message; Anthropic API takes it as a top-level field
    const systemMessage = messages.find((m: any) => m.role === "system");
    const nonSystemMessages = messages.filter((m: any) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        system: systemMessage?.content,
        messages: nonSystemMessages,
        max_tokens: 32000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);

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

    (async () => {
      const reader = response.body!.getReader();
      let buffer = "";
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
              await writer.write(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                const openAiChunk = JSON.stringify({ choices: [{ delta: { content: event.delta.text } }] });
                await writer.write(encoder.encode(`data: ${openAiChunk}\n\n`));
              }
            } catch { /* skip malformed lines */ }
          }
        }
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Error in generate-itinerary function:", error);
    return new Response(JSON.stringify({ error: "Unable to process request. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

