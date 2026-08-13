import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
      // Include the body: a bare status can't distinguish a revoked key from an
      // exhausted balance from a malformed header, and this failure is silent
      // enough already.
      const errorBody = await response.text().catch(() => '');
      console.error("Perplexity API error:", response.status, errorBody.slice(0, 500));
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

// ============================================================================
// STABLE SYSTEM PROMPT CORE
//
// Anthropic's prompt cache is prefix-matched: the cache covers everything up to
// the cache_control breakpoint, and the first byte that differs from a previous
// request invalidates the whole entry. This block is therefore byte-identical
// for every request, every trip, and every theme — it holds only the schema,
// the rules, and the guidelines. It lives at module scope precisely so nothing
// request-specific can be interpolated into it by accident; the theme, the
// dates, the departure city, and the research regime all go in the variable
// tail block that follows it in the `system` array.
//
// This used to be one template literal with the theme name near the top and
// date-stamped booking URLs in the middle, which meant every generation wrote a
// fresh ~4k-token cache entry and read nothing back — paying the 1.25x write
// premium for zero reuse.
// ============================================================================
const ITINERARY_SYSTEM_CORE = `You are an expert travel planning AI assistant. Your task is to create comprehensive, well-researched travel itineraries with cited sources for every recommendation.

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
- NEVER INVENT A RESTAURANT TO FILL A SLOT. Every name must come from the grounded research, or be the place the traveler is already staying that day, or — where no research was available — be a long-established place you are confident still exists. If nothing for a location meets that bar, give one option, the lodging's own kitchen, rather than a second name you cannot stand behind. A slot with one sourced option is correct; a slot with an invented second option is a failure.
- WHERE MEALS ARE INCLUDED, SAY SO INSTEAD OF INVENTING CHOICE. When a stay includes meals or has no alternative nearby — a mountain hut or refuge on half board, a lodge, a ryokan, a safari camp, an all-inclusive, a boat, a remote village — the correct answer is that establishment. The same establishment MAY serve dinner and the next morning's breakfast; state that it is the hut/lodge's own dining room and what the meal plan covers.
- OTHERWISE VARY THE RESTAURANTS: in towns and cities, where the traveler has real choice, do not repeat an establishment across periods or days — branch into nearby neighborhoods for fresh options. Repetition is only correct when it reflects where the traveler actually is, never when it is padding.
- ONLY recommend restaurants confirmed to be currently open in the grounded research. If the research mentions any closure, "permanently closed", "temporarily closed", or uncertain status for an establishment, do NOT include it. When in doubt, prefer well-established restaurants with multiple recent reviews over newer or less-cited spots.
- MATCH THE MEAL TO THE PERIOD: Morning dining must be breakfast spots (cafés, bakeries, brunch, or the included hut/hotel breakfast). Afternoon must be lunch spots. Evening must be dinner. Do not put a dinner restaurant in a morning slot.
- VARY THE PRIMARY PICKS BY DAY where the destination offers a choice: the "isPrimary": true option should feel distinct day-to-day in cuisine, vibe, and neighborhood — showcase the destination's range, don't anchor every day to the same kind of place.
- Tags must only be from: transit, cultural, nature, hiking, beach, food, photo-worthy, walking, adventure, relaxation, shopping, nightlife
- priority must be exactly "high", "medium", or "low"
- Use real URLs from the grounded research — fall back to the search URL patterns given in the trip context below
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
- Include real, actionable URLs from the grounded research`;

const MODEL = "claude-sonnet-4-6";

// ── Split generation plumbing ───────────────────────────────────────────────
// A single call writing the whole itinerary is ~9,800 output tokens written
// serially, which is 92% of the wall clock. The work splits cleanly: one
// skeleton call decides everything that spans the trip (and, critically, which
// restaurant goes where), then one call per day writes that day's prose. Days
// have no dependency on each other once the skeleton has assigned names, so
// they run in parallel and the wall clock drops to skeleton + slowest day.

// A user-turn content block (text, image, or a text block carrying a cache
// breakpoint). Shapes are the Anthropic Messages API's, not ours to narrow.
type ContentBlock = Record<string, unknown>;

type AnthropicJsonResult = {
  text: string;
  stopReason: string | null;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
};

// Non-streaming: every call here has a modest max_tokens and the result is
// assembled server-side anyway, so there is nothing to stream to and buffering
// makes the error handling and JSON parsing straightforward.
async function callAnthropicJson(params: {
  apiKey: string;
  system: unknown[];
  userContent: unknown[];
  prefill: string;
  maxTokens: number;
  label: string;
}): Promise<AnthropicJsonResult> {
  const { apiKey, system, userContent, prefill, maxTokens, label } = params;
  // Two attempts. Splitting one call into N multiplies the failure surface, and
  // several slices firing at once is exactly what provokes a 429.
  const maxAttempts = 2;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      // Jittered so retrying slices don't re-collide on the same rate limit.
      const backoffMs = 1000 * attempt + Math.floor(Math.random() * 750);
      console.log(`[retry] ${label} attempt ${attempt} after ${backoffMs}ms (${lastError})`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          system,
          messages: [
            { role: "user", content: userContent },
            // Prefilling the assistant turn forces the output shape. It is the
            // only reliable way to stop a day slice from reproducing the whole
            // itinerary envelope described in the cached system prompt.
            { role: "assistant", content: prefill },
          ],
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastError = `${response.status} ${body.slice(0, 300)}`;
        // 4xx other than 429 will fail identically on retry.
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`Anthropic ${label} failed: ${lastError}`);
        }
        continue;
      }

      const data = await response.json();
      const usage = data.usage ?? {};
      const result: AnthropicJsonResult = {
        // The API returns only the continuation, so the prefill has to be put
        // back before the text is valid JSON.
        text: prefill + (data.content?.[0]?.text ?? ""),
        stopReason: data.stop_reason ?? null,
        outputTokens: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      };
      console.log(
        `[timing] cache ${label}: read=${result.cacheRead} write=${result.cacheWrite} ` +
        `uncached_input=${usage.input_tokens ?? 0} output=${result.outputTokens} stop=${result.stopReason}`,
      );
      return result;
    } catch (err) {
      lastError = String(err);
      if (attempt === maxAttempts) throw err;
    }
  }

  throw new Error(`Anthropic ${label} failed after ${maxAttempts} attempts: ${lastError}`);
}

// Close a JSON document the model ran out of tokens to finish. Same bracket-stack
// approach the client uses on truncated content, kept here so a slice that hits
// max_tokens degrades to a short day rather than taking the whole trip down.
function repairTruncatedJson(input: string): string {
  let text = input.trimEnd().replace(/,\s*$/, "");
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) text += '"';
  text = text.replace(/,\s*$/, "");
  while (stack.length) text += stack.pop();
  return text;
}

function parseModelJson<T>(raw: string, label: string): T {
  // Progressively more aggressive cleanups. The model is told not to wrap its
  // output in a code fence and is prefilled with an opening brace, but it does
  // it anyway often enough that a bare JSON.parse is not a safe single attempt —
  // and here a parse failure costs the whole split path.
  const candidates = [raw];

  const defenced = raw.replace(/```[a-z]*/gi, "").trim();
  if (defenced !== raw) candidates.push(defenced);

  // A fence arriving after the prefill leaves a stray leading brace, so also try
  // the outermost object found in the text.
  const open = defenced.indexOf("{");
  const close = defenced.lastIndexOf("}");
  if (open !== -1 && close > open) {
    candidates.push(defenced.slice(open, close + 1));
    // …and the object after a duplicated opening brace ("{" + "{...}").
    const second = defenced.indexOf("{", open + 1);
    if (second !== -1 && /^\{\s*$/.test(defenced.slice(open, second))) {
      candidates.push(defenced.slice(second, close + 1));
    }
  }

  for (const [i, candidate] of candidates.entries()) {
    try {
      const parsed = JSON.parse(candidate) as T;
      if (i > 0) console.warn(`[parse] ${label} recovered at cleanup ${i} (${raw.length} chars)`);
      return parsed;
    } catch { /* try the next shape */ }
  }

  // Last resort: the model ran out of tokens mid-document.
  try {
    const repaired = repairTruncatedJson(candidates[candidates.length - 1]);
    const parsed = JSON.parse(repaired) as T;
    console.warn(`[parse] ${label} needed truncation repair (${raw.length} chars)`);
    return parsed;
  } catch (err) {
    // Log what actually came back. Without this the only signal is a fallback
    // to the slow path with no way to tell why.
    console.error(`[parse] ${label} unparseable (${raw.length} chars). Head: ${JSON.stringify(raw.slice(0, 400))}`);
    throw err;
  }
}

// Group the trip's days into per-call slices. One day per call is the fast case
// and covers every trip the form can produce at its default; longer trips group
// up so a 60-day itinerary doesn't fan out into 60 concurrent calls.
function planDaySlices(dayCount: number): number[][] {
  const perSlice = dayCount <= 10 ? 1 : dayCount <= 20 ? 2 : 3;
  const slices: number[][] = [];
  for (let start = 0; start < dayCount; start += perSlice) {
    const size = Math.min(perSlice, dayCount - start);
    slices.push(Array.from({ length: size }, (_, k) => start + k + 1));
  }
  return slices;
}

// Bounds how many slice calls are in flight at once. All the promises are
// created up front so the caller can await them in order, but the work itself
// is gated here.
function makeLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
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

    const { preferences, themeVariant, jobId, batchId } = validationResult.data;
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
    // Trimmed: a secret pasted with a trailing newline produces an
    // "Authorization: Bearer pplx-…\n" header and a 401 that looks exactly like
    // a revoked key.
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")?.trim();
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
        const resolutionPrompt = `You are a travel destination expert. Based on the traveler's preferences below, choose 1-2 destinations that best fit. Be decisive and concrete — a place a traveler can actually plan around, never a continent or a vague area like "Southeast Asia".

Pick the unit that matches how the trip actually moves:
- A trip based in one place is a city: "Chiang Mai, Thailand".
- A trip that moves through an area — a road trip, a thru-hike, a hut-to-hut trek, island hopping, a wine route — is the region plus the anchor towns that bound it: "Dolomites, Italy (Cortina d'Ampezzo to Ortisei)". Naming only the gateway city would send the research to the wrong place, because the trip happens between the towns, not in one of them.

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
["Dolomites, Italy (Cortina d'Ampezzo to Ortisei)"]
["Kii Peninsula, Japan (Kumano Kodo, Tanabe to Nachi)"]

No explanation. Just the JSON array.`;

        const resolutionResponse = await timePhase("destination_resolution", () =>
          fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5",
              messages: [{ role: "user", content: resolutionPrompt }],
              // Region answers carry their anchor towns, so they run longer than a bare city name.
              max_tokens: 200,
            }),
          }));

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
    console.log("Starting Perplexity grounded research...");

    const destinationStr = resolvedCities.length > 0 ? resolvedCities.join(', ') : 'popular travel destinations';
    const primaryCity = resolvedCities[0] || 'the destination';
    const interestsStr = interests?.length > 0 ? interests.join(', ') : 'general sightseeing';
    const foodStr = foodDrink?.length > 0 ? foodDrink.join(', ') : 'local cuisine';
    const themeStr = themeVariant?.name || '';
    const currentYear = new Date().getFullYear();

    // The traveler's own words are usually the most specific thing in the
    // request ("hut to hut", "no driving", "travelling with a toddler"). They
    // used to reach only the final prompt, so the research never saw the trip
    // the user actually described.
    const tripNotes = (additionalNotes ?? '').trim().slice(0, 500);
    const notesClause = tripNotes
      ? ` The traveler describes the trip as: "${tripNotes}". Prioritise recommendations that fit that description.`
      : '';

    // Determine trip length for context-aware queries
    const tripDaysNum = durationDays || 7;
    const isSingleCity = resolvedCities.length === 1;
    const isLongTrip = tripDaysNum >= 7;

    // Keyed so a conditional query can be added without shifting the indices
    // the context block reads from.
    const searchSpecs: { key: string; query: string }[] = [
      // Activities and things to do
      {
        key: 'activities',
        query: `Best things to do in ${destinationStr} for ${interestsStr} travelers. Include specific activity names, tour recommendations, must-visit attractions, hidden gems, and neighborhoods to explore.${themeStr ? ` Focus on ${themeStr} experiences.` : ''} ${budgetInfo.label} budget level.${notesClause}`,
      },

      // Restaurants and food scene — emphasise currently operating
      {
        key: 'restaurants',
        query: `Best ${foodStr} restaurants currently open in ${destinationStr} as of ${currentYear}. Only include establishments confirmed to be actively operating with recent positive reviews. Include specific restaurant names, neighborhoods, price ranges, and what they are known for. Exclude any restaurants that have closed, are temporarily closed, or have uncertain operating status. ${budgetInfo.label} budget.${tripNotes ? ` The traveler describes the trip as: "${tripNotes}" — if this trip spends nights somewhere without restaurants nearby (a mountain hut, a lodge, a remote village, a boat), say so and name where meals are actually eaten there instead.` : ''}`,
      },

      // Where to sleep, in whatever form this trip actually needs
      {
        key: 'accommodation',
        query: `Best ${budgetInfo.label} places to stay in ${destinationStr} priced ${budgetInfo.accommodation}. ${startDate && endDate ? `For dates: check-in ${startDate}, check-out ${endDate}.` : targetMonth ? `For travel in ${targetMonth}.` : ''} Include specific names with nightly rates and where each one is.${tripNotes ? ` The traveler describes the trip as: "${tripNotes}" — include the kinds of lodging this trip actually requires (for example mountain huts or refuges, guesthouses, campsites, lodges, hostels, ryokan), not only conventional hotels, and note how each is booked and what a night includes such as half board.` : ''}`,
      },

      // Nearby destinations + transportation (combined)
      {
        key: 'nearbyAndTransport',
        query: isSingleCity && isLongTrip
          ? `For a ${tripDaysNum}-day trip based in ${primaryCity}: what other cities should I visit, how to travel between them (trains, buses, flights with prices and times), and how many days to spend in each? Include day trips and overnight options.${notesClause}`
          : `Best day trips and nearby destinations from ${destinationStr} for a ${tripDaysNum}-day trip. Include travel time, transport options with prices, and why each is worth visiting.${notesClause}`,
      },

      // Seasonal & practical information
      {
        key: 'seasonal',
        query: `${destinationStr} travel in ${targetMonth || 'the travel season'}. Include weather, peak vs off-season pricing, festivals or events, crowd levels, and any seasonal closures.${notesClause}`,
      },

      // Planning, booking windows, access rules, conditions and required skill.
      // These are the details that decide whether a trip is possible at all,
      // and none of the queries above ask about them.
      {
        key: 'planning',
        query: `Practical planning for a ${tripDaysNum}-day trip in ${destinationStr}${targetMonth ? ` in ${targetMonth}` : ''}${tripNotes ? `, described by the traveler as: "${tripNotes}"` : ''}. Answer each of these specifically for ${currentYear}: (1) How far in advance do the places to stay need to be booked, and how is each one booked — online, by email, deposit required, cash only? (2) What permits, reservations, entry fees, timed-entry slots, or vehicle and access restrictions apply, and how are they obtained? (3) What conditions, closures, or seasonal limits affect this trip, and what is the usable window? (4) What fitness or skill level, equipment, and guiding does it require, and where locally can equipment be rented or a guide hired, at what price?`,
      },
    ];

    // Flight estimates (conditional)
    if (!noFlight && departureCity) {
      searchSpecs.push({
        key: 'flights',
        query: `Flights from ${departureCity} to ${primaryCity} in ${targetMonth || 'upcoming months'}. Include typical price ranges, best airlines, flight duration, and whether nonstop options exist.`,
      });
    }

    // Run all searches in parallel for speed
    console.log(`Executing ${searchSpecs.length} Perplexity research queries...`);
    const results = await timePhase("perplexity_research", () =>
      Promise.all(searchSpecs.map(spec => searchWithPerplexity(spec.query, PERPLEXITY_API_KEY))));

    type ResearchResult = { content: string; citations: string[] };
    const research: Record<string, ResearchResult | undefined> = {};
    searchSpecs.forEach((spec, i) => { research[spec.key] = results[i]; });

    // Every search failing returns empty content rather than throwing, so the
    // research block can assemble into nothing but section headers. Left
    // unchecked the model is then handed "ONLY recommend places that appear in
    // the research" alongside no research at all — contradictory instructions
    // that it can only resolve by inventing establishments and URLs, which is
    // the exact failure the rules were written to prevent.
    const hasGroundedResearch = results.some(r => r.content.trim().length > 0);
    // Per-query, not just an overall boolean. `grounded` is true when ANY of the
    // seven queries returned something, so a restaurant search that came back
    // nearly empty — the one failure that shows up directly in the itinerary as
    // unnamed, category-only dining picks — was previously invisible here.
    console.log("[research] " + JSON.stringify(
      Object.fromEntries(searchSpecs.map((spec, i) => [
        spec.key,
        { chars: results[i].content.trim().length, citations: results[i].citations?.length ?? 0 },
      ])),
    ));
    console.log(`Perplexity research completed. grounded=${hasGroundedResearch}`);
    if (!hasGroundedResearch) {
      console.error("All Perplexity searches returned empty — generating without grounding.");
    }

    const activitiesResearch = research.activities;
    const restaurantsResearch = research.restaurants;
    const accommodationResearch = research.accommodation;
    const nearbyAndTransportResearch = research.nearbyAndTransport;
    const seasonalResearch = research.seasonal;
    const planningResearch = research.planning;
    const flightResearch = research.flights; // Undefined when no flight query ran

    const citeList = (r: ResearchResult | undefined) =>
      r?.citations?.length ? r.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available';

    const groundedResearchContext = `
## GROUNDED RESEARCH DATA (From Live Web Search)

**CRITICAL INSTRUCTIONS:** The following is retrieved from live web search — treat it as FACTUAL GROUNDING.
- ONLY recommend places, activities, and restaurants that appear in this research
- Do NOT hallucinate establishment names or URLs
- For anything not in the research, use the fallback URL patterns in the system prompt

---

### 🗺️ NEARBY DESTINATIONS, DAY TRIPS & TRANSPORTATION
${nearbyAndTransportResearch?.content || 'No nearby destinations/transport research available.'}

**Citations:**
${citeList(nearbyAndTransportResearch)}

---

### 📅 SEASONAL & PRACTICAL INFORMATION
${seasonalResearch?.content || 'No seasonal research available.'}

**Citations:**
${citeList(seasonalResearch)}

---

### 🧭 PLANNING, BOOKING, ACCESS & CONDITIONS
${planningResearch?.content || 'No planning research available.'}

**Use this section for:** bookingChecklist lead times and costs, summary.assumptions, transitNote content, and any permit, reservation, access restriction, seasonal window, or required gear/guiding the traveler must arrange. If this research says something must be booked months ahead, requires a permit, or needs equipment or a guide, that belongs in the itinerary — do not leave it out because it is not an attraction.

**Citations:**
${citeList(planningResearch)}

---

### ✈️ FLIGHT INFORMATION
${flightResearch?.content || 'No flight research available - use Google Flights for accurate pricing.'}

**Citations:**
${citeList(flightResearch)}

---

### 🎯 ACTIVITIES & THINGS TO DO
${activitiesResearch?.content || 'No activity research available.'}

**Citations:**
${citeList(activitiesResearch)}

---

### 🍽️ RESTAURANTS & FOOD
${restaurantsResearch?.content || 'No restaurant research available.'}

**Citations:**
${citeList(restaurantsResearch)}

---

### 🏨 ACCOMMODATION
${accommodationResearch?.content || 'No accommodation research available.'}

**User's Accommodation Budget:** ${budgetInfo.accommodation}
**If prices exceed this range, note why and provide a budget alternative.**

**Citations:**
${citeList(accommodationResearch)}
`;

    // Two sourcing regimes. With live research, the model is held to it. Without,
    // it is told plainly that there is none and pointed at the search-URL
    // patterns — rather than being ordered to source from an empty document,
    // which leaves fabrication as the only way to satisfy the instruction.
    const researchInstructions = hasGroundedResearch
      ? `## Research Requirements

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
8. **If the research is thin for part of the trip, say less rather than more.** Fewer, sourced recommendations beat a full-looking day built on invention. Note the gap in summary.assumptions.`
      : `## Research Requirements (NO LIVE RESEARCH AVAILABLE)

Live web search returned nothing for this trip, so there is no research document — do not refer to one.

**STRICT RULES - YOU MUST FOLLOW THESE:**

1. **Recommend only long-established, well-known places you are confident actually exist** and have operated for years. Prefer institutions over recent openings, which you cannot verify are still trading.
2. **Never invent a direct URL.** You have no citations to draw on, so every link must be built from the search URL patterns below — a search URL that resolves is correct; a guessed booking or restaurant homepage is not.
3. **Do not state prices, opening hours, or availability as fact.** Give ranges and label them estimates.
4. **Prefer a neighborhood or a dish over a specific restaurant** when you are unsure a particular establishment is still open.
5. **For restaurants near activities**, use Google Maps search URLs for the neighborhood:
   - Format: https://www.google.com/maps/search/?api=1&query=restaurants+near+NEIGHBORHOOD+CITY`;

    // The trip-specific tail of the system prompt. This sits AFTER the cached
    // core in the `system` array, so the theme name, the research regime, and
    // the date-stamped booking URLs can vary per request without invalidating
    // the cached prefix.
    const tripSystemContext = `## Trip-Specific Context

${themeContext ? themeContext + "\n\n" : ""}${researchInstructions}

**If something specific isn't in the research, use these SEARCH URL patterns as fallback:**
- Places: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY
- Tours: https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY
- Hotels: https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY${startDate ? `&checkin=${formatDateForBooking(startDate)}` : ''}${endDate ? `&checkout=${formatDateForBooking(endDate)}` : ''}
- Flights: https://www.google.com/travel/flights?q=flights+from+${departureCity ? departureCity.replace(/\s+/g, '+') : 'ORIGIN'}+to+DESTINATION${startDate ? `+departing+${formatDateForBooking(startDate)}` : ''}${endDate ? `+returning+${formatDateForBooking(endDate)}` : ''}

Output ONLY the JSON object. No text before or after it.`;

    const userPrompt = `Here are my travel planning inputs:

<user_inputs>
${userInputsBlock}
</user_inputs>

Create a comprehensive, well-researched travel itinerary based on these preferences. Be opinionated and specific - tell me exactly what I should do.`;

    // Runtime kill switch. Edge functions only deploy from main, so if the split
    // path misbehaves in production the fix has to be something that does not
    // require a deploy: set ITINERARY_SPLIT_GENERATION=off and every request
    // reverts to the single-call path.
    const splitGenerationEnabled =
      (Deno.env.get("ITINERARY_SPLIT_GENERATION") ?? "").trim().toLowerCase() !== "off";

    // ── Shared prompt pieces ────────────────────────────────────────────────
    // `system` is byte-identical for the skeleton call and every day slice, so
    // all of them share the one cached core entry.
    const systemBlocks = [
      { type: "text", text: ITINERARY_SYSTEM_CORE, cache_control: { type: "ephemeral" } },
      { type: "text", text: tripSystemContext },
    ];

    // The grounded research leads every user turn and carries the second cache
    // breakpoint. The skeleton call writes that entry; the day slices then read
    // it at a tenth of the price instead of re-prefilling several thousand
    // tokens of research each. Only sent when it actually holds research —
    // otherwise it is section headers wrapped around "No activity research
    // available", which costs tokens and reads as a document the model failed
    // to use.
    const researchBlocks: ContentBlock[] = [];
    if (hasGroundedResearch && groundedResearchContext) {
      researchBlocks.push({
        type: "text",
        text: groundedResearchContext,
        cache_control: { type: "ephemeral" },
      });
      console.log("Injected grounded research context into the user message");
    }

    // Media (images/videos) - use public URLs from storage. Anthropic takes an
    // image block with a `source`; `image_url` is the OpenAI shape and 400s here.
    // These go to the skeleton call only: they inform the destination and the
    // trip's overall character, both of which the skeleton fixes for everyone
    // else. They sit after the research breakpoint, so they cannot disturb the
    // prefix the slices match against.
    const mediaBlocks: ContentBlock[] = [];
    const mediaWithUrls = media?.filter(item => item.url && item.type === 'image') || [];
    for (const item of mediaWithUrls) {
      if (item.url) {
        mediaBlocks.push({ type: "image", source: { type: "url", url: item.url } });
      }
    }
    if (mediaWithUrls.length > 0) {
      console.log(`Attached ${mediaWithUrls.length} image(s) to the skeleton request`);
    }

    // ── Pass 1: the skeleton ────────────────────────────────────────────────
    // Everything that spans the trip, plus the day roster. The roster is the
    // load-bearing part: day slices run in parallel and cannot see each other,
    // so if they each picked their own restaurants they would converge on the
    // same top-rated places. Assigning every name here, in one context that can
    // see the whole trip, makes uniqueness structural instead of something the
    // model has to track across ~9,800 tokens.
    const skeletonInstruction = `${userPrompt}

## THIS CALL: PLAN ONLY — DO NOT WRITE THE DAYS

The itinerary is written in two passes and this is pass 1. A separate pass writes each day's activities and dining prose, so do NOT produce a "days" array here.

Output ONLY this JSON object. **"dayPlan" comes first and there is NO "days" key** — writing out the days here is the one thing this pass must not do.

{
  "dayPlan": [
    {
      "dayNumber": 1,
      "title": "Arrival and Ponta Delgada",
      "location": "Ponta Delgada",
      "transitNote": "Pick up rental car at PDL Airport",
      "dining": {
        "Morning": ["Café do Mar", "Pastelaria Garrett"],
        "Afternoon": ["Restaurante A Tasca"],
        "Evening": ["Tony's Restaurant", "Restaurante Muchacho"]
      }
    }
  ],
  "summary": { ... },
  "budget": { ... },
  "flights": { ... },
  "accommodation": [ ... ],
  "bookingChecklist": [ ... ],
  "alternatives": [ ... ]
}

summary, budget, flights, accommodation, bookingChecklist and alternatives follow the schema and the strict rules in the system prompt exactly.

**dayPlan replaces the "days" array for this pass:**
- One entry per day of the trip. The number of entries IS the trip length — decide it from the duration constraints above.
- dayNumber, title, location and transitNote are the same fields as in the days[] schema. Omit transitNote on days with no travel.
- **dining holds the ASSIGNED RESTAURANT NAMES for that day's three periods — names only.** No descriptions, no prices, no URLs; pass 2 writes those from the research.
- **EVERY ENTRY MUST BE A REAL ESTABLISHMENT'S PROPER NAME, copied from the research.** "Ristorante Il Cavatappi", "Osteria del Beccaccino", "Bar Il Molo" are names. "Trattoria in Varenna village", "Dinner at a lakeside ristorante", "a family-run osteria", "Lakefront café" are CATEGORY DESCRIPTIONS, not names. A category description is never acceptable — not as a top pick, not as a second option, not to complete a day. It is the same failure as inventing a restaurant, and it is worse than leaving the slot empty, because the traveler is handed a search box instead of a table.
- **RUNNING OUT OF NAMES IS AN ACCEPTABLE OUTCOME. PADDING IS NOT.** If the research does not contain enough named establishments to fill every period, leave the extra periods out — give an empty array, or omit the period key. A trip with nine real named restaurants and twelve empty slots is correct. A trip with twenty-one filled slots where half are categories is a failure. Note the shortfall in summary.assumptions.
- Give 1 or 2 names per period. The first is the top pick. Add a second ONLY when a real, separate alternative exists within reach of where the traveler actually is at that hour — one real option beats two where the second is filler.
- **THIS IS WHERE RESTAURANT UNIQUENESS IS DECIDED, AND IT CANNOT BE FIXED LATER.** The day passes run independently and cannot see each other's choices. Before you finish, read back over the entire dayPlan: if the same establishment appears on two different days, or twice in one day, replace one of them with a different place from the research.
- The ONLY name that may legitimately repeat is a stay's own dining room — a hut, refuge, lodge, ryokan, safari camp, boat, or hotel where meals are included or nothing else is within reach. Where that is genuinely where the traveler eats, repeat it and say which stay it is.
- Every name must come from the grounded research, or be the traveler's own lodging for that night. Never invent one to fill a slot.
- Match the meal to the period (Morning = breakfast, Afternoon = lunch, Evening = dinner), and vary cuisine, vibe and neighborhood day to day.

Output ONLY the JSON object. Do not include a "days" key.`;

    type DayPlanEntry = {
      dayNumber?: number;
      title?: string;
      location?: string;
      transitNote?: string;
      dining?: Record<string, string[]>;
    };
    type Skeleton = Record<string, unknown> & { dayPlan?: DayPlanEntry[]; days?: unknown[] };

    // ── Stream plumbing ─────────────────────────────────────────────────────
    // The response goes back before any model work starts, so the client's
    // fetch resolves immediately rather than waiting out the skeleton call. A
    // failure after this point marks the job errored and closes the stream
    // without [DONE]; the client already treats a stream that stops short as
    // recoverable and polls the job, which is where it finds the error.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const pump = (async () => {
      let clientConnected = true;
      let emitted = "";

      const forward = async (chunk: string) => {
        if (!clientConnected) return;
        try {
          await writer.write(encoder.encode(chunk));
        } catch {
          clientConnected = false;
        }
      };

      // Accumulate what the client is sent so the persisted copy and the
      // streamed copy can never disagree.
      const emit = async (text: string) => {
        if (!text) return;
        emitted += text;
        await forward(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      };

      const modelStart = Date.now();
      const failedDays: number[] = [];
      let skeletonTokens = 0;
      let sliceTokens = 0;
      let sliceCount = 0;
      let dayCount = 0;

      const persistComplete = async () => {
        if (!jobId) return;
        const { error: saveError } = await supabaseAdmin.from("itinerary_jobs").update({
          status: "complete",
          content: emitted,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        if (saveError) console.error("Failed to persist itinerary result:", saveError);
      };

      // The pre-split path: one streaming call that writes the whole itinerary
      // serially. Kept because edge functions only deploy from main, so there is
      // no way to try the split path on a branch first — this is both the kill
      // switch and the landing place when the skeleton pass fails.
      const runSingleCall = async () => {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            system: systemBlocks,
            messages: [{
              role: "user",
              content: [...researchBlocks, ...mediaBlocks, { type: "text", text: userPrompt }],
            }],
            max_tokens: 32000,
            stream: true,
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Anthropic single-call failed: ${response.status} ${body.slice(0, 300)}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                await emit(event.delta.text);
              }
              const stop = event.type === "message_delta" ? event.delta?.stop_reason : null;
              if (stop && stop !== "end_turn") {
                console.error(`Single-call generation did not finish cleanly: stop_reason=${stop}`);
              }
              if (event.type === "message_start" && event.message?.usage) {
                const u = event.message.usage;
                console.log(`[timing] cache single_call: read=${u.cache_read_input_tokens ?? 0} ` +
                  `write=${u.cache_creation_input_tokens ?? 0} uncached_input=${u.input_tokens ?? 0}`);
              }
            } catch { /* skip malformed lines */ }
          }
        }
      };

      // Pass 1. Returns null when the plan can't be produced or parsed, which
      // sends the request down the single-call path rather than failing it.
      const trySkeleton = async (): Promise<Skeleton | null> => {
        try {
          const skeletonStart = Date.now();
          const skeletonResult = await callAnthropicJson({
            apiKey: ANTHROPIC_API_KEY,
            system: systemBlocks,
            userContent: [...researchBlocks, ...mediaBlocks, { type: "text", text: skeletonInstruction }],
            // Prefilling the key, not just the brace. The cached system prompt
            // describes a "days" array at length, and a bare "{" leaves the
            // model free to open with it and write the whole itinerary here —
            // which is what drops the request onto the slow single-call path.
            prefill: '{"dayPlan": [',
            maxTokens: 8000,
            label: "skeleton",
          });
          timings.skeleton_generation = Date.now() - skeletonStart;
          skeletonTokens = skeletonResult.outputTokens;
          console.log(`[timing] skeleton_generation: ${timings.skeleton_generation}ms`);

          const parsed = parseModelJson<Skeleton>(skeletonResult.text, "skeleton");
          const hasPlan = Array.isArray(parsed.dayPlan) && parsed.dayPlan.length > 0;
          // The cached system prompt describes a "days" array in detail, so the
          // likeliest miss is the model writing that instead of dayPlan. That is
          // not a failure worth throwing away: it means the plan pass already
          // wrote the whole itinerary, and re-running it as a single call — what
          // used to happen — pays twice for one result. The caller uses those
          // days directly.
          const hasDays = Array.isArray(parsed.days) && parsed.days.length > 0;
          if (!hasPlan && !hasDays) {
            throw new Error(
              `skeleton returned neither dayPlan nor days (top-level keys: ${Object.keys(parsed).join(", ") || "none"})`,
            );
          }
          if (!hasPlan) {
            console.warn("[split] skeleton wrote a full days array instead of dayPlan — using it as-is");
          }
          return parsed;
        } catch (err) {
          console.error("[split] skeleton pass failed — falling back to single-call generation:", err);
          return null;
        }
      };

      try {
        // Comment lines are ignored by the client's SSE reader and by every
        // proxy in between; this just puts a byte on the wire immediately so
        // nothing idles the connection out during the skeleton call.
        await forward(": generating\n\n");

        if (!splitGenerationEnabled) {
          console.log("[split] disabled by ITINERARY_SPLIT_GENERATION=off");
        }
        const skeleton = splitGenerationEnabled ? await trySkeleton() : null;

        if (!skeleton) {
          await runSingleCall();
          await forward("data: [DONE]\n\n");
          timings.model_generation = Date.now() - modelStart;
          timings.total = since(t0);
          console.log("[timing] summary " + JSON.stringify({
            ...timings,
            mode: "single_call",
            output_chars: emitted.length,
            theme: themeVariant?.id ?? "default",
            grounded: hasGroundedResearch,
            client_disconnected: !clientConnected,
          }));
          await persistComplete();
          return;
        }

        // The plan pass wrote the finished days rather than a roster. Emit them
        // and stop — there is nothing left for pass 2 to do, and this costs one
        // call instead of the two the fallback used to spend.
        const skeletonDays = Array.isArray(skeleton.days) ? skeleton.days : [];
        if ((skeleton.dayPlan?.length ?? 0) === 0 && skeletonDays.length > 0) {
          const tail: Record<string, unknown> = {};
          for (const key of ["summary", "budget", "flights", "accommodation", "bookingChecklist", "alternatives"]) {
            if (skeleton[key] !== undefined) tail[key] = skeleton[key];
          }
          const tailJson = JSON.stringify(tail);
          await emit('{"days":' + JSON.stringify(skeletonDays));
          await emit(tailJson.length > 2 ? "," + tailJson.slice(1) : "}");
          await forward("data: [DONE]\n\n");
          timings.model_generation = Date.now() - modelStart;
          timings.total = since(t0);
          console.log("[timing] summary " + JSON.stringify({
            ...timings,
            mode: "skeleton_complete",
            day_count: skeletonDays.length,
            skeleton_output_tokens: skeletonTokens,
            output_chars: emitted.length,
            theme: themeVariant?.id ?? "default",
            grounded: hasGroundedResearch,
            client_disconnected: !clientConnected,
          }));
          await persistComplete();
          return;
        }

        const dayPlan = skeleton.dayPlan ?? [];
        dayCount = dayPlan.length;

        // Normalise the roster: the day slices are addressed by position, so
        // dayNumber must be 1..N regardless of what the model wrote.
        const roster = dayPlan.map((entry, i) => ({
          dayNumber: i + 1,
          title: typeof entry.title === "string" ? entry.title : `Day ${i + 1}`,
          location: typeof entry.location === "string" ? entry.location : "",
          transitNote: typeof entry.transitNote === "string" ? entry.transitNote : undefined,
          dining: entry.dining && typeof entry.dining === "object" ? entry.dining : {},
        }));

        const slices = planDaySlices(roster.length);
        sliceCount = slices.length;
        console.log(`[timing] day slices: ${roster.length} days across ${slices.length} call(s)`);

        // The assigned names, before any day call has run. If these are already
        // generic ("Trattoria in Varenna village") the skeleton could not find
        // named establishments in the research; if they are real here but
        // generic in the finished itinerary, a day call ignored its assignment.
        // Without this the two failures are indistinguishable from the output.
        console.log("[quality] roster dining: " + JSON.stringify(
          roster.map(d => Object.values(d.dining ?? {}).flat()),
        ));

        // The whole roster goes to every slice: each one needs to know which
        // names belong to other days so it does not reach for them.
        const rosterJson = JSON.stringify(roster);
        const sharedPlanJson = JSON.stringify({
          summary: skeleton.summary,
          accommodation: skeleton.accommodation,
        });

        // ── Pass 2: the days, in parallel ─────────────────────────────────
        const limit = makeLimiter(8);
        const slicesStart = Date.now();
        const slicePromises = slices.map(dayNumbers => limit(async () => {
          const label = `day${dayNumbers.join("+")}`;
          const only = dayNumbers.length === 1
            ? `day ${dayNumbers[0]}`
            : `days ${dayNumbers.join(" and ")}`;

          const sliceInstruction = `${userPrompt}

## THIS CALL: WRITE ${only.toUpperCase()} ONLY — PASS 2

Pass 1 already planned this trip. That plan is FIXED: do not re-plan it, do not change it, and do not write any day other than ${only}.

<trip_plan>
${sharedPlanJson}
</trip_plan>

<day_roster>
${rosterJson}
</day_roster>

Output ONLY this JSON object, containing exactly ${dayNumbers.length} element(s) — ${only}:

{"days": [ ${dayNumbers.map(n => `<the full days[] element for day ${n}>`).join(", ")} ]}

Each element follows the days[] schema in the system prompt exactly.

**Rules for this pass:**
- dayNumber, title, location and transitNote come from the day_roster entry for your day. Keep them as written.
- Exactly 3 periods — Morning, Afternoon, Evening — and exactly 2 activities in each.
- **THE DINING IS ALREADY ASSIGNED.** Use exactly the names in your day's roster entry, in the order given: the first is "isPrimary": true, a second is "isPrimary": false. Do not substitute a name, do not add one, do not drop one. Your job is to write each one's description, priceRange and url from the research.
- **IF A PERIOD HAS NO ASSIGNED NAME, IT GETS NO DINING.** Give that period an empty dining array. The one exception is the place the traveler is staying that night, when they genuinely eat there — name that stay. Never fill an empty period with a category description like "Trattoria in the village" or "a lakeside ristorante": a search box dressed up as a recommendation is worse than showing nothing.
- **EVERY OTHER DAY'S RESTAURANTS ARE LISTED IN THE ROSTER AND BELONG TO THOSE DAYS.** Never use one of them, even if it would fit yours better.
- The other days' titles and locations tell you what the rest of the trip covers. Choose activities that do not duplicate them — the traveler should not do the same thing twice.
- Everything else follows the strict rules in the system prompt.

Output ONLY the JSON object with the "days" key.`;

          const result = await callAnthropicJson({
            apiKey: ANTHROPIC_API_KEY,
            system: systemBlocks,
            userContent: [...researchBlocks, { type: "text", text: sliceInstruction }],
            prefill: '{"days": [',
            // A day runs ~1,200 output tokens, so this leaves generous headroom
            // per day in the slice. A cap that a 3-day slice can reach would
            // truncate the last day of the group.
            maxTokens: 2000 * dayNumbers.length + 1500,
            label,
          });
          const parsed = parseModelJson<{ days?: unknown[] }>(result.text, label);
          return { days: Array.isArray(parsed.days) ? parsed.days : [], tokens: result.outputTokens };
        }).then(
          value => ({ ok: true as const, value }),
          // Settled at creation, not at await. Every slice starts at once but
          // is awaited in trip order, so a later slice can reject while an
          // earlier one is still running — with no handler attached yet that
          // surfaces as an unhandled rejection and takes the isolate down.
          (error: unknown) => ({ ok: false as const, error }),
        ));

        // ── Assemble and emit in order ────────────────────────────────────
        // Days are awaited in trip order even though they complete out of
        // order, so the JSON goes out well-formed and progressively rather
        // than in one lump at the end.
        //
        // "days" is emitted FIRST and everything from the skeleton follows it.
        // JSON key order carries no meaning to the parser, and putting the
        // skeleton last means summary can be written once, at the end, already
        // knowing which days failed — rather than being emitted early and then
        // needing a second, contradictory copy appended.
        const assembledDays: Record<string, unknown>[] = [];

        // A day the model could not produce still gets its roster identity, so
        // the trip keeps its shape and the gap is named rather than silently
        // dropped. `periods: []` renders as an empty day, and the note added to
        // summary.assumptions below tells the traveler which day to regenerate.
        const placeholderDay = (dayNumber: number) => {
          const entry = roster[dayNumber - 1];
          failedDays.push(dayNumber);
          return {
            dayNumber,
            title: entry?.title ?? `Day ${dayNumber}`,
            location: entry?.location ?? "",
            ...(entry?.transitNote ? { transitNote: entry.transitNote } : {}),
            periods: [],
            generationFailed: true,
          };
        };

        await emit('{"days":[');

        for (let i = 0; i < slicePromises.length; i++) {
          const dayNumbers = slices[i];
          let produced: Record<string, unknown>[] = [];
          const settled = await slicePromises[i];
          if (settled.ok) {
            sliceTokens += settled.value.tokens;
            produced = settled.value.days as Record<string, unknown>[];
          } else {
            // One slice failing must not cost the traveler the other six days.
            console.error(`[slice] ${dayNumbers.join("+")} failed:`, settled.error);
          }

          // Match returned days by their own dayNumber rather than by position:
          // a multi-day slice can emit them out of order, or hand back more days
          // than it was asked for, and either would silently mislabel a day if
          // we just took produced[k].
          const byNumber = new Map<number, Record<string, unknown>>();
          produced.forEach((d, idx) => {
            const claimed = (d as { dayNumber?: unknown })?.dayNumber;
            const key = typeof claimed === "number" ? claimed : dayNumbers[idx];
            if (typeof key === "number" && !byNumber.has(key)) byNumber.set(key, d);
          });

          for (let k = 0; k < dayNumbers.length; k++) {
            const dayNumber = dayNumbers[k];
            const raw = byNumber.get(dayNumber) ?? produced[k];
            const entry = roster[dayNumber - 1];
            let day: Record<string, unknown>;
            if (raw && typeof raw === "object" && Array.isArray((raw as { periods?: unknown }).periods)) {
              day = {
                ...raw,
                // Position is ours to guarantee, not the model's.
                dayNumber,
                title: (raw as { title?: string }).title || entry?.title || `Day ${dayNumber}`,
                location: (raw as { location?: string }).location || entry?.location || "",
              };
            } else {
              day = placeholderDay(dayNumber);
            }
            assembledDays.push(day);
            await emit(`${assembledDays.length > 1 ? "," : ""}${JSON.stringify(day)}`);
          }
        }

        // Everything the skeleton produced, written after the days so the
        // failure note below can go into summary.assumptions directly.
        const tail: Record<string, unknown> = {};
        for (const key of ["summary", "budget", "flights", "accommodation", "bookingChecklist", "alternatives"]) {
          if (skeleton[key] !== undefined) tail[key] = skeleton[key];
        }

        // Name the gap where the traveler will actually read it, rather than
        // shipping a blank day with no explanation.
        if (failedDays.length > 0) {
          const summary = (tail.summary ?? {}) as Record<string, unknown>;
          const existing = Array.isArray(summary.assumptions) ? summary.assumptions : [];
          const plural = failedDays.length > 1;
          tail.summary = {
            ...summary,
            assumptions: [
              ...existing,
              `Day${plural ? "s" : ""} ${failedDays.join(", ")} could not be generated — regenerate the itinerary to fill ${plural ? "them" : "it"} in.`,
            ],
          };
        }

        const tailJson = JSON.stringify(tail);
        await emit("]" + (tailJson.length > 2 ? "," + tailJson.slice(1) : "}"));

        await forward("data: [DONE]\n\n");

        timings.model_generation = Date.now() - modelStart;
        timings.day_slices_wall = Date.now() - slicesStart;
        timings.total = since(t0);
        console.log("[timing] summary " + JSON.stringify({
          ...timings,
          mode: "split",
          slice_count: sliceCount,
          day_count: dayCount,
          skeleton_output_tokens: skeletonTokens,
          slice_output_tokens: sliceTokens,
          output_tokens: skeletonTokens + sliceTokens,
          output_chars: emitted.length,
          failed_days: failedDays,
          theme: themeVariant?.id ?? "default",
          grounded: hasGroundedResearch,
          client_disconnected: !clientConnected,
        }));

        // The constraint this whole split risks: parallel slices converging on
        // the same restaurant. Log it so a regression shows up in production
        // logs instead of in a traveler's itinerary. The stay's own dining room
        // is excluded — repeating that is correct, not a collision.
        const lodgingNames = new Set<string>();
        for (const loc of (skeleton.accommodation as { options?: { name?: string }[] }[] | undefined) ?? []) {
          for (const opt of loc?.options ?? []) {
            if (opt?.name) lodgingNames.add(opt.name.trim().toLowerCase());
          }
        }
        const seen = new Map<string, number>();
        for (const day of assembledDays) {
          for (const period of ((day.periods as { dining?: { name?: string }[] }[]) ?? [])) {
            for (const d of period?.dining ?? []) {
              const key = d?.name?.trim().toLowerCase();
              if (!key || lodgingNames.has(key)) continue;
              seen.set(key, (seen.get(key) ?? 0) + 1);
            }
          }
        }
        const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
        console.log(`[quality] dining: unique=${seen.size} duplicated=${duplicates.length} ` +
          (duplicates.length ? JSON.stringify(duplicates.map(([name, n]) => `${name} x${n}`)) : ""));

        // Persist the finished itinerary for reconnecting clients.
        await persistComplete();
      } catch (streamError) {
        console.error("Generation/persist error:", streamError);
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

