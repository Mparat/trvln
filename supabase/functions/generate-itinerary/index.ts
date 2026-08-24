import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CostTracker, persistCost } from "../_shared/costs.ts";
import { handleCreateCheckoutSession, handleConfirmCheckout, handleStripeWebhook } from "../_shared/stripeHttp.ts";
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

// Resolve the caller from the Authorization header when it carries a user
// access token. verify_jwt stays off for this function (signed-out previews
// are allowed), so an absent, anon-key, or invalid token yields null rather
// than an error.
async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7));
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

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
  // Optional only for resume requests (completeBatchId) — a normal generation
  // without preferences is rejected in the handler.
  preferences: PreferencesSchema.optional(),
  themeVariant: ThemeVariantSchema,
  // Optional: when provided, the finished itinerary is persisted so a
  // backgrounded/reloaded tab can reconnect and fetch the completed result.
  jobId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  // Resume-on-unlock: finish the locked days of an already-entitled batch's
  // job. Mutually exclusive with a normal generation.
  completeBatchId: z.string().uuid().optional(),
});

// ── Preview gating ───────────────────────────────────────────────────────────
// Free (un-entitled) generations are truncated server-side: the primary
// variant writes only the first FREE_PRIMARY_DAYS days, secondary variants
// write none. Locked days ship as title-only placeholders and the real
// content is never generated — the paid remainder is produced later by
// resume-on-unlock. See docs/payments-spec.md §4.3.
type Tier = "full" | "preview_primary" | "preview_secondary";
const FREE_PRIMARY_DAYS = 3;
const paywallEnabled = () => (Deno.env.get("PAYWALL") ?? "off").toLowerCase() === "on";

// The batch's earliest-registered job is the primary variant. A retry
// re-registers under a fresh jobId but keeps its theme, so when the earliest
// row isn't this job, matching themes still count as primary. Derived
// server-side — the client is not trusted on tier-relevant input.
//
// Purchasers don't get preview trips: the first generation of a new batch
// spends one credit (entitle_batch is idempotent per batch, so retries and
// later variants never re-charge), and at zero balance the request is
// paywalled instead of generating. The spend deliberately happens HERE, when
// a generation is actually accepted — never in a pre-check — so an abandoned
// click can't burn a credit.
async function resolveTier(args: {
  batchId: string | null;
  jobId?: string;
  themeId: string | null;
  userId: string | null;
}): Promise<{ tier: Tier; paywalled: boolean }> {
  if (!paywallEnabled()) return { tier: "full", paywalled: false };
  const { batchId, jobId, themeId, userId } = args;

  // An entitlement grants full tier only to the user who owns it — batch ids
  // leak through the readable jobs table, so an unscoped check here would let
  // anyone generate for free under someone else's paid batch.
  if (batchId && userId) {
    const { data: entitlement } = await supabaseAdmin
      .from("trip_entitlements")
      .select("user_id")
      .eq("batch_id", batchId)
      .eq("user_id", userId)
      .maybeSingle();
    if (entitlement) return { tier: "full", paywalled: false };
  }

  let primary = true;
  // Whether this job is the batch's first — i.e. a NEW trip rather than a
  // later variant (or retry) of one that already began as a preview.
  let firstJobOfBatch = true;
  if (batchId && jobId) {
    const { data: earliest } = await supabaseAdmin
      .from("itinerary_jobs")
      .select("id, theme_id")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (earliest && earliest.id !== jobId) {
      firstJobOfBatch = false;
      primary = (earliest.theme_id ?? null) === themeId;
    }
  }

  if (userId && batchId && firstJobOfBatch) {
    const { data: purchase } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (purchase) {
      const { error } = await supabaseAdmin.rpc("entitle_batch", {
        p_user: userId,
        p_batch: batchId,
      });
      if (!error) return { tier: "full", paywalled: false };
      if (String(error.message ?? "").includes("INSUFFICIENT_CREDITS")) {
        return { tier: "preview_primary", paywalled: true };
      }
      // Any other failure falls toward preview, never toward free full access.
      console.error("entitle_batch failed:", error);
    }
  }

  return { tier: primary ? "preview_primary" : "preview_secondary", paywalled: false };
}

// Split the booking checklist into what a preview may ship and per-priority
// counts of what it may not. Locked items are counted, never sent — the client
// renders sized placeholder rows from the counts alone.
function redactChecklist(items: unknown, tier: Tier): {
  visible: unknown[];
  lockedCounts: Record<string, number>;
} {
  const list = Array.isArray(items) ? items : [];
  const priorityOf = (it: unknown): "high" | "medium" | "low" => {
    const p = (it as { priority?: string })?.priority;
    return p === "high" ? "high" : p === "medium" ? "medium" : "low";
  };
  const visible: unknown[] = [];
  const lockedCounts: Record<string, number> = { high: 0, medium: 0, low: 0 };
  for (const item of list) {
    const priority = priorityOf(item);
    if (tier === "preview_primary" && priority === "high") {
      visible.push(item);
    } else {
      lockedCounts[priority]++;
    }
  }
  return { visible, lockedCounts };
}


// Helper function to call Perplexity for grounded web search.
//
// Every query is retried on 429. All six searches fire at once, and Perplexity
// rate-limits the burst: production logs showed one query succeeding and five
// returning `429 request_rate_limit_exceeded` within milliseconds. Because a
// failed search returned empty rather than raising, that surfaced not as an
// error but as an itinerary with no named restaurants — the model had nothing
// to name. `label` identifies which search is retrying in the logs.
async function searchWithPerplexity(
  query: string,
  apiKey: string,
  label = "search",
): Promise<{ content: string; citations: string[]; usage?: Record<string, unknown> }> {
  const maxAttempts = 4;
  let retryAfterMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      // Prefer the server's own retry-after. Otherwise back off steeply and
      // jittered — the first fix used ~1s and production still showed the same
      // query 429ing on its retry, so the delay has to clear the window rather
      // than land just after it.
      const backoffMs = retryAfterMs || 1500 * (attempt - 1) + Math.floor(Math.random() * 1200);
      console.log(`[research] ${label} retrying in ${backoffMs}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    const result = await runPerplexityQuery(query, apiKey, label);
    if (result.ok) return result.value;
    if (!result.retryable) return { content: '', citations: [] };
    retryAfterMs = result.retryAfterMs ?? 0;
  }

  console.error(`[research] ${label} exhausted ${maxAttempts} attempts — returning empty`);
  return { content: '', citations: [] };
}

async function runPerplexityQuery(
  query: string,
  apiKey: string,
  label: string,
): Promise<
  | { ok: true; value: { content: string; citations: string[]; usage?: Record<string, unknown> } }
  | { ok: false; retryable: boolean; retryAfterMs?: number }
> {
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
            content: 'You are a travel research assistant. Provide specific, detailed recommendations with exact names of restaurants, hotels, tours, and activities. When researching hotels, prioritize options within the specified price range and include nightly rates. If most options exceed the budget, explicitly note this and suggest alternatives. Include price ranges when available. Be comprehensive but concise.\n\nWhen a query carries a SOURCING instruction, treat it as part of the question rather than as advice. It asks you to attribute, not to search anywhere in particular — search as you normally would, then say where each answer came from. Where it asks you to check a published schedule, fee or rule against first-hand accounts, report both and say plainly when they disagree — a discrepancy is a finding, not something to average away. Never present a fact you found in one place as though it were corroborated, and say when you could not find something at all rather than substituting the nearest thing you could find.'
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
      console.error(`Perplexity API error (${label}):`, response.status, errorBody.slice(0, 500));
      // Perplexity does not always send retry-after; when it does, it beats guessing.
      const retryAfter = Number(response.headers.get("retry-after"));
      // A rate limit clears on its own; a 401/400 will not.
      return {
        ok: false,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 8000)
          : undefined,
      };
    }

    const data = await response.json();
    return {
      ok: true,
      value: {
        content: data.choices?.[0]?.message?.content || '',
        citations: data.citations || [],
        usage: data.usage,
      },
    };
  } catch (error) {
    console.error(`Perplexity search error (${label}):`, error);
    return { ok: false, retryable: true };
  }
}

// ============================================================================
// GOOGLE PLACES DINING BACKBONE
//
// Web research reads editorial coverage, and editorial food coverage is
// dinner-shaped: "where to eat in X" articles rarely name a breakfast café,
// so for destinations whose blogs cover only dinner (Whistler, most resort
// towns) the morning and midday slots went out empty — the roster rules
// correctly refuse to invent names, but the research never supplied any.
// Google Maps has no such bias: it lists every operating café with its live
// rating and review history. So dining names are grounded on Places data
// first, and the web research supplies texture (what to order, whether to
// book, what the room is like) on top.
//
// Fail-soft throughout: a missing key or a failed request returns nothing and
// generation proceeds on web research alone, exactly as before.
// ============================================================================

type DiningPlace = {
  name: string;
  rating: number;
  ratingCount: number;
  price: string; // "$".."$$$$", or "" when Maps has no price level
  address: string;
  mapsUrl: string;
  wellKnown?: boolean; // set at selection: heavily-trafficked pick vs quieter find
};
type CityDining = { city: string; meals: Record<string, DiningPlace[]> };

// The form's food & drink ids, as words a Maps text search understands. An id
// with no mapping passes through as-is so free-form values still steer.
const FOOD_PREF_PHRASE: Record<string, string> = {
  local: "serving regional specialties",
  casual: "casual",
  romantic: "romantic",
  family: "family-friendly",
  party: "lively",
};

// One search per meal period plus one that hunts what the traveler could not
// pull up themselves: Maps text relevance matches review language, so asking
// for "underrated" and "hidden gem" surfaces the places reviewers describe
// that way — loved rather than famous. The traveler's food preferences steer
// the dinner search, where they express a kind of evening; breakfast and
// lunch stay broad because a café is a café whatever the trip's vibe.
const MEAL_GROUPS = ["Breakfast", "Lunch", "Dinner", "Local favorites"] as const;

function buildMealSearches(foodPrefs: string[]): { meal: string; query: (city: string) => string }[] {
  const prefWords = foodPrefs
    .map(p => FOOD_PREF_PHRASE[p.trim().toLowerCase()] ?? p.trim())
    .filter(Boolean)
    .slice(0, 2); // two qualifiers keep the query a phrase, not a word salad
  const dinnerQualifier = prefWords.length ? `${prefWords.join(" and ")} ` : "";
  return [
    { meal: "Breakfast", query: c => `best breakfast cafes and bakeries in ${c}` },
    { meal: "Lunch", query: c => `best casual lunch restaurants in ${c}` },
    { meal: "Dinner", query: c => `best ${dinnerQualifier}dinner restaurants in ${c}` },
    { meal: "Local favorites", query: c => `underrated hidden gem restaurants local favorites in ${c}` },
  ];
}

const PRICE_LEVEL_LABEL: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

async function placesTextSearch(textQuery: string, apiKey: string): Promise<DiningPlace[]> {
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus,places.shortFormattedAddress,places.googleMapsUri",
      },
      // The API's maximum page: the quieter-find pool selects from below the
      // top of the ranking, so the deeper the page, the more there is to find.
      body: JSON.stringify({ textQuery, pageSize: 20 }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[places] ${response.status} for "${textQuery}": ${body.slice(0, 300)}`);
      return [];
    }
    const data = await response.json();
    type RawPlace = {
      displayName?: { text?: unknown };
      rating?: unknown;
      userRatingCount?: unknown;
      priceLevel?: unknown;
      businessStatus?: unknown;
      shortFormattedAddress?: unknown;
      googleMapsUri?: unknown;
    };
    const places: RawPlace[] = Array.isArray(data.places) ? data.places : [];
    return places
      .filter(p => (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL")
      .map(p => ({
        name: typeof p.displayName?.text === "string" ? p.displayName.text : "",
        rating: typeof p.rating === "number" ? p.rating : 0,
        ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : 0,
        price: PRICE_LEVEL_LABEL[String(p.priceLevel ?? "")] ?? "",
        address: typeof p.shortFormattedAddress === "string" ? p.shortFormattedAddress : "",
        mapsUrl: typeof p.googleMapsUri === "string" ? p.googleMapsUri : "",
      }))
      .filter(p => p.name);
  } catch (error) {
    console.error(`[places] search failed for "${textQuery}":`, error);
    return [];
  }
}

// The floor keeps out places nobody has vouched for — a 5.0★ with 12 reviews
// is unverified, and a mountain town's real café clears 25 reviews easily.
const MIN_PLACE_RATING = 4.0;
const MIN_PLACE_REVIEWS = 25;

// Selection deliberately does NOT rank by popularity alone. Review volume
// measures how trafficked a place is, not how good it is, and a list sorted
// by it is exactly the result the traveler gets from a two-second Maps
// search — the opposite of a recommendation. Each meal gets two pools: a few
// heavily-trafficked picks as the reliable floor, and as many equally-rated
// quieter finds — the highest-rated places the crowd hasn't got to, least
// reviewed first among equals. The labels travel into the prompt so the model
// can choose the quieter one on purpose when it fits the traveler better.
const WELL_KNOWN_PER_MEAL = 4;
const QUIETER_PER_MEAL = 4;
const QUIETER_MIN_RATING = 4.4;

function pickMealOptions(candidates: DiningPlace[]): DiningPlace[] {
  const eligible = candidates.filter(
    p => p.rating >= MIN_PLACE_RATING && p.ratingCount >= MIN_PLACE_REVIEWS,
  );
  const traffic = (p: DiningPlace) => p.rating * Math.log10(p.ratingCount + 1);
  const wellKnown = [...eligible]
    .sort((a, b) => traffic(b) - traffic(a))
    .slice(0, WELL_KNOWN_PER_MEAL)
    .map(p => ({ ...p, wellKnown: true }));
  const taken = new Set(wellKnown.map(p => p.name));
  const quieter = eligible
    .filter(p => !taken.has(p.name) && p.rating >= QUIETER_MIN_RATING)
    .sort((a, b) => b.rating - a.rating || a.ratingCount - b.ratingCount)
    .slice(0, QUIETER_PER_MEAL)
    .map(p => ({ ...p, wellKnown: false }));
  return [...wellKnown, ...quieter];
}

// Four requests per city; the cap bounds cost on multi-stop trips. Cities
// come ordered as the trip visits them, so the ones cut are the tail stops.
const MAX_PLACES_CITIES = 4;

async function fetchDiningPlaces(
  cities: string[],
  apiKey: string | undefined,
  foodPrefs: string[],
): Promise<{ dining: CityDining[]; requests: number }> {
  if (!apiKey) {
    console.warn("[places] GOOGLE_PLACES_API_KEY not configured — dining grounds on web research only");
    return { dining: [], requests: 0 };
  }
  if (cities.length === 0) return { dining: [], requests: 0 };

  const searches = buildMealSearches(foodPrefs);
  let requests = 0;
  const dining = await Promise.all(cities.slice(0, MAX_PLACES_CITIES).map(async city => {
    const found: Record<string, DiningPlace[]> = {};
    await Promise.all(searches.map(async ({ meal, query }) => {
      requests++;
      found[meal] = await placesTextSearch(query(city), apiKey);
    }));
    // Groups are selected in MEAL_GROUPS order and a name keeps its first
    // slot: "Local favorites" overlaps the meal searches, and a place listed
    // twice would read as two options where the traveler has one.
    const meals: Record<string, DiningPlace[]> = {};
    const seen = new Set<string>();
    for (const meal of MEAL_GROUPS) {
      const picked = pickMealOptions((found[meal] ?? []).filter(p => !seen.has(p.name)));
      for (const p of picked) seen.add(p.name);
      meals[meal] = picked;
    }
    return { city, meals };
  }));

  return {
    dining: dining.filter(d => Object.values(d.meals).some(m => m.length > 0)),
    requests,
  };
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
      "overview": "A gentle landing day: everything sits within a short walk of the hotel, so jet lag sets the pace and nothing needs booking ahead.",
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
              "description": "Watch the sun set over the Atlantic from the marina boardwalk, five minutes from dinner. A slow first evening — the volcano hikes you came for start tomorrow, rested.",
              "duration": "1 hour",
              "cost": "Free",
              "tags": ["nature", "photo-worthy"]
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
- Hard caps on every trip-level list — these bound how long the plan takes to write, and the whole generation runs against a fixed wall clock: at most 3 flights.options, at most 2 accommodation options per location, at most 6 bookingChecklist items (the ones with real lead times or consequences), at most 2 alternatives. Fewer is always acceptable; choosing the best two beats listing four.
- Every day must have exactly 3 periods: Morning, Afternoon, Evening
- Give each period the number of activities the day actually warrants: 1 to 3. Two is common, but a period built around a single real thing — a long walk, a day trip, a lunch that runs into the afternoon — takes exactly one, and padding it to two is the clearest tell that an itinerary was generated rather than planned. A day that is genuinely one big thing may run one activity per period throughout.
- Deliberate open time is a legitimate entry and often the most human thing on the page: an unstructured hour in a named neighborhood, a slow morning after a late arrival, an afternoon left free because the day before was long. Name it as an activity and say what it is for. This is not a way to fill space you could not research — that is a different thing and it reads differently.
- Include 1 or 2 dining options for every period: Morning (breakfast), Afternoon (lunch), Evening (dinner). The first must have "isPrimary": true (top pick); include a second with "isPrimary": false ONLY when a real, separate alternative exists within reach of where the traveler actually is at that hour. One real option beats two where the second is filler.
- NEVER INVENT A RESTAURANT TO FILL A SLOT. Every name must come from the grounded research, or be the place the traveler is already staying that day, or — where no research was available — be a long-established place you are confident still exists. If nothing for a location meets that bar, give one option, the lodging's own kitchen, rather than a second name you cannot stand behind. A slot with one sourced option is correct; a slot with an invented second option is a failure.
- WHERE MEALS ARE INCLUDED, SAY SO INSTEAD OF INVENTING CHOICE. When a stay includes meals or has no alternative nearby — a mountain hut or refuge on half board, a lodge, a ryokan, a safari camp, an all-inclusive, a boat, a remote village — the correct answer is that establishment. The same establishment MAY serve dinner and the next morning's breakfast; state that it is the hut/lodge's own dining room and what the meal plan covers.
- OTHERWISE VARY THE RESTAURANTS: in towns and cities, where the traveler has real choice, do not repeat an establishment across periods or days — but find the fresh option near where the day already is. PROXIMITY BEATS VARIETY: a meal belongs beside that hour's activities, and a distinct-but-distant pick is the wrong one. Repetition is only correct when it reflects where the traveler actually is, never when it is padding.
- ONLY recommend restaurants confirmed to be currently open in the grounded research. If the research mentions any closure, "permanently closed", "temporarily closed", or uncertain status for an establishment, do NOT include it. When in doubt, prefer well-established restaurants with multiple recent reviews over newer or less-cited spots.
- MATCH THE MEAL TO THE PERIOD: Morning dining must be breakfast spots (cafés, bakeries, brunch, or the included hut/hotel breakfast). Afternoon must be lunch spots. Evening must be dinner. Do not put a dinner restaurant in a morning slot.
- VARY THE PRIMARY PICKS BY DAY where the destination offers a choice: the "isPrimary": true option should feel distinct day-to-day in cuisine and vibe — showcase the destination's range, don't anchor every day to the same kind of place. Range comes from the food, never from sending the traveler across town: each day's picks stay near that day's ground.
- Tags must only be from: transit, cultural, nature, hiking, beach, food, photo-worthy, walking, adventure, relaxation, shopping, nightlife
- priority must be exactly "high", "medium", or "low"
- Use real URLs from the grounded research — fall back to the search URL patterns given in the trip context below
- Keep ALL descriptions to 1-2 tight sentences (35 words maximum). The first sentence says plainly WHAT the traveler will be doing, the way a travel agent prescribing a trip would — in words someone who has never heard of the place, the operator, or the sport can follow. Never lean on an unexplained abbreviation, brand, or insider shorthand: "a guided mountain-bike ride on Mount Currie's trail network", not "guided singletrack MTB". Add a second sentence only when it earns its place, to say why this pick is right for THIS traveler at THIS hour — tie it to what they asked for, what came before it in the day, or why it beats the obvious alternative.
- Make every word earn its place. Say the specific reason for this, here, at this hour — the light on the ridge before the first cable car, the one thing on the menu, why it follows what came before. Never a label that would fit any comparable place: "charming local spot", "iconic landmark", "hidden gem", "a must-see". If a description would survive being moved to a different city — or a different traveler's trip — unchanged, it is not doing its job: rewrite it.
- Keep activity names under 6 words. A name may be a proper noun (the operator, the trail, the museum), but any sport or activity type it mentions must appear in plain words in the description — a reader should never have to decode the name
- Always populate each day's overview: 1–2 plain sentences (35 words max) telling the traveler how the day fits together — why it runs in this order, how the pieces connect (a short walk apart, one drive, needs the morning light), and what kind of day it is (big push, slow recovery, travel day). Explain the reasoning; never restate the title.
- Omit bookingUrl entirely if it would be an empty string
- If noFlight is true, set flights.skip to true and flights.options to []
- Always populate summary.bestTimeNote with 1 sentence about the best time to visit and why
- Always populate summary.vibeSummary with ONE short evocative sentence (10-16 words) capturing the trip's overall vibe and pace — e.g. "Old towns, sea-captains' palaces, island churches, and centuries of maritime history." No destination name, no markdown.
- Always populate flights.context with a summary of the routing (e.g. "Round-trip from City to Destination (IATA) · N stops · ~Xh door to gate.")
- Always populate all structured flight fields: airlineCode, route, viaCity, airline, stops, duration, departureTime. Set badge to "Best value", "Fastest", or omit for others.
- Always populate budget items with a description field explaining what the cost covers

## Guidelines

**Composition — what separates a planned trip from a list of good things. These decide the day roster, so they apply when assigning what happens on which day:**
- Give the trip a shape. The arrival day and the last day are lighter than the middle. No two consecutive days should have the same rhythm — a full day out is followed by one that stays close to home. Something the traveler explicitly said they came for should land early enough that one bad-weather day later does not cost them the trip.
- Sequence geographically, at both scales. Across the trip: consecutive days cover adjacent ground, and once the trip leaves an area it does not double back (except to the gateway to depart). Within a day: cluster in one area and route it without backtracking — a day should not cross the city twice, and its meals sit along the route, not across town. Where two stops are a short walk apart, say so; where a move is the point of the day, let it be the day.
- Anticipate. Where the research says something depends on weather, conditions, or a booking that may not come through, name the fallback in that day's transitNote instead of leaving the traveler to improvise.
- Let the trip build. What the traveler will remember belongs where they are acclimatised enough to appreciate it, not on the morning they land jet-lagged.

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

// The two output shapes, as forced tool calls. `claude-sonnet-4-6` rejects
// assistant prefill with a 400 ("This model does not support assistant message
// prefill"), and structured outputs (output_config.format) is not available on
// it either — so a forced tool_choice is the only way to guarantee the shape at
// the API level rather than by asking the model nicely. That guarantee is what
// stops the plan pass from writing a full itinerary, and it makes a stray ```json
// fence impossible: tool input arrives already parsed.
//
// Both tools are declared on EVERY call and the caller picks one with
// tool_choice. Tools render before the system prompt, so a per-call tools array
// would give the skeleton and the day slices different cache prefixes; keeping
// the array byte-identical means they share one cached entry, and tool_choice
// does not invalidate it.
const TRIP_PLAN_TOOL = {
  name: "emit_trip_plan",
  description:
    "Record the trip-level plan and the per-day roster. This is pass 1: it does NOT contain the written-out days.",
  input_schema: {
    type: "object",
    properties: {
      // dayPlan FIRST, deliberately. A tool's input is generated in schema
      // order, and with the roster last the model was choosing every restaurant
      // for the trip roughly 3,000 tokens deep — the exact "tracking names
      // across a long generation" problem the roster exists to remove.
      // Production bore that out: 14 slots, 9 distinct names, days 1 and 2 an
      // identical pair. Written first, the roster is chosen while the research
      // is the freshest thing in context.
      dayPlan: {
        type: "array",
        description:
          "Write this FIRST. One entry per day of the trip: dayNumber, title, location, area (the one neighborhood/zone the day clusters in), anchors (2-4 short named activities from the research that define the day, each with a word on where it sits), optional transitNote, and a dining object mapping Morning/Afternoon/Evening to the assigned restaurant names. Every restaurant name and every anchor across the whole array must be different, except a stay's own dining room.",
      },
      summary: { type: "object", description: "The summary object from the schema." },
      budget: { type: "object", description: "The budget object from the schema." },
      flights: { type: "object", description: "The flights object from the schema." },
      accommodation: { type: "array", description: "The accommodation array from the schema." },
      bookingChecklist: { type: "array", description: "The bookingChecklist array from the schema." },
      alternatives: { type: "array", description: "The alternatives array from the schema." },
    },
    required: ["dayPlan", "summary"],
  },
};

const DAYS_TOOL = {
  name: "emit_days",
  description: "Record the finished day objects for the day(s) assigned to this call.",
  input_schema: {
    type: "object",
    properties: {
      days: {
        type: "array",
        description: "Full days[] elements, exactly as the schema in the system prompt defines them.",
      },
    },
    required: ["days"],
  },
};

const ITINERARY_TOOLS = [TRIP_PLAN_TOOL, DAYS_TOOL];

// Supabase kills the isolate at 150s of wall clock. Everything optional has to
// know how much of that is already gone, because the failure mode is not a
// slower itinerary — it is no itinerary at all, mid-stream.
const WALL_CLOCK_BUDGET_MS = 150_000;
// The plan review costs ~11s and only earns that back if the days it comments
// on actually get written. Measured: research ~32s + plan ~77s put a normal
// request at ~110s here, and the cutoff sat at 115s. The roster now also
// carries per-day area + anchors (~45 output tokens/day, ≈ +5s on a typical
// trip), so the cutoff moves down by the same margin: a request that arrives
// late skips the review rather than gambling the days against the 150s kill.
const REVIEW_BUDGET_CUTOFF_MS = 108_000;

type AnthropicJsonResult = {
  data: Record<string, unknown>;
  stopReason: string | null;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  usage: Record<string, number>;
};

// Non-streaming, and the shape is forced with tool_choice rather than asked for
// in prose: the result is a parsed object straight off the tool call, so there
// is no JSON to extract and no code fence to survive.
async function callAnthropicJson(params: {
  apiKey: string;
  system: unknown[];
  userContent: unknown[];
  toolName: string;
  maxTokens: number;
  label: string;
}): Promise<AnthropicJsonResult> {
  const { apiKey, system, userContent, toolName, maxTokens, label } = params;
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
          messages: [{ role: "user", content: userContent }],
          tools: ITINERARY_TOOLS,
          tool_choice: { type: "tool", name: toolName },
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
      const blocks: { type?: string; name?: string; input?: unknown; text?: string }[] =
        Array.isArray(data.content) ? data.content : [];

      const toolCall = blocks.find(b => b?.type === "tool_use" && b?.name === toolName);
      let payload: Record<string, unknown> | null =
        toolCall && toolCall.input && typeof toolCall.input === "object"
          ? toolCall.input as Record<string, unknown>
          : null;

      // tool_choice makes a tool call mandatory, so this should not happen —
      // but a text answer is recoverable and losing the call is not.
      if (!payload) {
        const text = blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("");
        if (!text.trim()) {
          throw new Error(`Anthropic ${label} returned no ${toolName} tool call and no text`);
        }
        console.warn(`[tool] ${label} answered with text instead of ${toolName}; parsing it`);
        payload = parseModelJson<Record<string, unknown>>(text, label);
      }

      const result: AnthropicJsonResult = {
        data: payload,
        stopReason: data.stop_reason ?? null,
        outputTokens: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        usage,
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

// Cap how often one restaurant can recur across the roster.
//
// Telling the model "every restaurant must be different" does not hold:
// production returned 14 slots across 9 names, with two days assigned an
// identical pair and one place appearing three times. So the limit is enforced
// here rather than requested — but it is a CAP, not a uniqueness rule. Some
// repetition is correct: a small lake village may genuinely have two places
// worth eating at, and a real restaurant twice beats an invented one once.
// This drops only the excess beyond MAX_USES, which kills "the same place four
// times" without flattening a destination that truly has few options.
//
// The traveler's own lodging is exempt entirely: eating repeatedly at the hut
// or hotel you are sleeping in is where you are, not a failure of variety.
const MAX_RESTAURANT_USES = 2;

function dedupeRosterDining(
  roster: { dayNumber: number; dining: Record<string, unknown> }[],
  lodgingNames: Set<string>,
  maxUses = MAX_RESTAURANT_USES,
): { assigned: string[]; dropped: string[] } {
  const useCount = new Map<string, number>();
  const assignedDisplay: string[] = [];
  const dropped: string[] = [];

  for (const day of roster) {
    const dining = day.dining ?? {};
    for (const period of Object.keys(dining)) {
      const names = Array.isArray(dining[period]) ? dining[period] as unknown[] : [];
      const kept: string[] = [];
      for (const raw of names) {
        const name = String(raw ?? "").trim();
        const key = name.toLowerCase();
        if (!key) continue;
        // A stay's own dining room may recur without limit.
        if (lodgingNames.has(key)) { kept.push(name); continue; }
        const used = useCount.get(key) ?? 0;
        if (used >= maxUses) { dropped.push(`day${day.dayNumber}:${name}`); continue; }
        useCount.set(key, used + 1);
        if (used === 0) assignedDisplay.push(name);
        kept.push(name);
      }
      dining[period] = kept;
    }
  }

  return { assigned: assignedDisplay, dropped };
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

// Group an arbitrary set of day numbers (resume writes only the days that were
// locked) using the same per-call sizing rule as planDaySlices.
function chunkDayNumbers(dayNumbers: number[], totalDays: number): number[][] {
  const perSlice = totalDays <= 10 ? 1 : totalDays <= 20 ? 2 : 3;
  const slices: number[][] = [];
  for (let i = 0; i < dayNumbers.length; i += perSlice) {
    slices.push(dayNumbers.slice(i, i + perSlice));
  }
  return slices;
}

// Each finding names the day it is about, so it reaches only the writer who
// can act on it. A finding that names no day is trip-wide and goes to every
// slice — rarer, since the review is asked to name one, and cheaper to repeat
// than to drop.
function findingsForDays(findings: string[], dayNumbers: number[]): string[] {
  return findings.filter(f => {
    const mentioned = [...f.matchAll(/\bday\s*(\d+)/gi)].map(m => Number(m[1]));
    return mentioned.length === 0 || mentioned.some(n => dayNumbers.includes(n));
  });
}

// The pass-2 day-writing instruction, shared verbatim by the normal split path
// and by resume-on-unlock, so an unlocked day is written under exactly the
// rules its free siblings were.
function buildSliceInstruction(args: {
  userPrompt: string;
  sharedPlanJson: string;
  rosterJson: string;
  dayNumbers: number[];
  takenList: string[];
  findings: string[];
}): string {
  const { userPrompt, sharedPlanJson, rosterJson, dayNumbers, takenList, findings } = args;
  const only = dayNumbers.length === 1
    ? `day ${dayNumbers[0]}`
    : `days ${dayNumbers.join(" and ")}`;
  return `${userPrompt}

## THIS CALL: WRITE ${only.toUpperCase()} ONLY — PASS 2

Pass 1 already planned this trip. That plan is FIXED: do not re-plan it, do not change it, and do not write any day other than ${only}.

<trip_plan>
${sharedPlanJson}
</trip_plan>

<day_roster>
${rosterJson}
</day_roster>

Call the \`emit_days\` tool with exactly ${dayNumbers.length} element(s) in its "days" array — ${only}:

{"days": [ ${dayNumbers.map(n => `<the full days[] element for day ${n}>`).join(", ")} ]}

Each element follows the days[] schema in the system prompt exactly.

**Rules for this pass:**
- dayNumber, title, location and transitNote come from the day_roster entry for your day. Keep them as written.
- Write the day's "overview" yourself: 1–2 sentences the traveler reads first, explaining how the day fits together — the logic of the order, the distances, the pacing. Not a restatement of the title.
- Exactly 3 periods — Morning, Afternoon, Evening — each with 1 to 3 activities: the number the day actually warrants, per the system rules. A period built around one real thing takes exactly one, and deliberate open time in a named place is a legitimate activity. Do not pad a period to two.
- **YOUR DAY'S \`anchors\` ARE ITS ASSIGNED ACTIVITIES**, planned in one pass that saw the whole trip. Build the day from them: every anchor appears as an activity, placed in the period that suits it best, plus at most small connective things near them. Anchors listed on OTHER days belong to those days — never use one, even if it would fit yours better. (A roster entry without anchors leaves the choice to you, under the same rules.)
- **STAY IN YOUR DAY'S \`area\` AND ROUTE IT LIKE A LOCAL.** Order the periods' stops so the traveler moves through the area without backtracking or crossing it twice; where two stops are a short walk apart, say so in one of their descriptions. Everything in this day — activities and meals — should sit within the area unless the transitNote says the day moves.
- **THE DINING IS ALREADY ASSIGNED.** Use exactly the names in your day's roster entry, in the order given: the first is "isPrimary": true, a second is "isPrimary": false. Do not substitute a name, do not add one, do not drop one. Your job is to write each one's description, priceRange and url from the research.
- **IF A PERIOD HAS NO ASSIGNED NAME**, you may name one real establishment from the research for it — but ONLY a place that appears nowhere in <names_taken> below, and only if the research actually names one near where the traveler is at that hour. The place the traveler is staying that night also counts. Otherwise give that period an empty dining array. Never fill an empty period with a category description like "Trattoria in the village" or "a lakeside ristorante": a search box dressed up as a recommendation is worse than showing nothing.

<names_taken>
${takenList.join(", ") || "(none)"}
</names_taken>
- **EVERY OTHER DAY'S RESTAURANTS ARE LISTED IN THE ROSTER AND BELONG TO THOSE DAYS.** Never use one of them, even if it would fit yours better.
- The other days' titles, areas and anchors tell you what the rest of the trip covers. Choose connective activities that do not duplicate any of it — the traveler should not do the same thing twice, or a lightly reworded version of it.
${findings.length
    ? `
**A REVIEW OF THE PLAN FLAGGED THIS DAY.** The plan itself is fixed, but how full this day is and what goes in it are yours:

${findings.map(f => `- ${f}`).join("\n")}

Write the day so this is no longer true. If it says the day is too packed, give a period one activity instead of three, or make one of them open time with a reason — a lighter day that answers the note beats a full one that ignores it. A finding outranks the roster's anchors: where it says to drop or replace one of them, the finding wins.
`
    : ""}
- Everything else follows the strict rules in the system prompt.

Put the day(s) in the \`emit_days\` tool call. Do not write them out as text.`;
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

// ── Resume-on-unlock ─────────────────────────────────────────────────────────
// The second entry point into generation: a preview run banked its unredacted
// content and the exact day-slice inputs in itinerary_jobs_private; once the
// batch is entitled, this writes ONLY the locked days — no research, no
// re-planning — merges them with the already-written days, and streams the
// completed itinerary through the same SSE + job-polling contract as a normal
// generation, so the client's streaming and recovery machinery is reused
// untouched.

type ResumeState = {
  // area/anchors are absent on rosters banked before they existed — every
  // consumer treats them as optional.
  roster?: { dayNumber: number; title?: string; location?: string; area?: string; anchors?: string[]; transitNote?: string; dining?: Record<string, string[]> }[];
  lockedDayNumbers?: number[];
  takenList?: string[];
  planFindings?: string[];
  sharedPlanJson?: string;
  userPrompt?: string;
  systemBlocks?: unknown[];
  researchBlocks?: unknown[];
};

async function handleResume(args: {
  jobId?: string;
  completeBatchId: string;
  userId: string | null;
}): Promise<Response> {
  const { jobId, completeBatchId, userId } = args;
  const jsonRes = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (!jobId) return jsonRes({ error: "jobId is required to resume" }, 400);
  if (!userId) return jsonRes({ error: "Sign in required" }, 401);

  const { data: entitlement } = await supabaseAdmin
    .from("trip_entitlements")
    .select("user_id")
    .eq("batch_id", completeBatchId)
    .maybeSingle();
  if (!entitlement) return jsonRes({ error: "This trip is not unlocked" }, 402);
  if (entitlement.user_id !== userId) return jsonRes({ error: "Not your trip" }, 403);

  // The job must belong to the entitled batch — without this, an entitled
  // caller could name any other user's jobId and have its private content
  // generated, streamed, and published under the victim's public job row.
  const { data: jobRow } = await supabaseAdmin
    .from("itinerary_jobs")
    .select("batch_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!jobRow || jobRow.batch_id !== completeBatchId) {
    return jsonRes({ error: "Not your trip" }, 403);
  }

  const { data: priv } = await supabaseAdmin
    .from("itinerary_jobs_private")
    .select("content, resume_state")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!priv?.content) return jsonRes({ error: "resume_unavailable" }, 409);

  let known: Record<string, unknown>;
  try {
    known = JSON.parse(priv.content) as Record<string, unknown>;
  } catch {
    return jsonRes({ error: "resume_unavailable" }, 409);
  }
  const knownDays = Array.isArray(known.days) ? known.days as Record<string, unknown>[] : [];
  const { days: _days, ...fullTail } = known;

  const rs = (priv.resume_state ?? null) as ResumeState | null;
  const roster = rs?.roster ?? [];
  const writtenNumbers = new Set(knownDays
    .filter(d => Array.isArray((d as { periods?: unknown }).periods) && ((d as { periods: unknown[] }).periods).length > 0)
    .map(d => (d as { dayNumber?: unknown }).dayNumber)
    .filter((n): n is number => typeof n === "number"));
  const missing = (rs?.lockedDayNumbers ?? []).filter(n => !writtenNumbers.has(n));

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const canWrite = !!ANTHROPIC_API_KEY && !!rs?.userPrompt && !!rs?.sharedPlanJson &&
    Array.isArray(rs?.systemBlocks) && roster.length > 0;
  if (missing.length > 0 && !canWrite) return jsonRes({ error: "resume_unavailable" }, 409);

  // Mark the job pending for polling recovery; the redacted content stays in
  // place until the full copy replaces it.
  await supabaseAdmin.from("itinerary_jobs").update({
    status: "pending",
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const costs = new CostTracker();
  const t0 = Date.now();

  const pump = (async () => {
    let clientConnected = true;
    let emitted = "";
    const forward = async (chunk: string) => {
      if (!clientConnected) return;
      try { await writer.write(encoder.encode(chunk)); } catch { clientConnected = false; }
    };
    const emit = async (text: string) => {
      if (!text) return;
      emitted += text;
      await forward(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    };

    try {
      await forward(": resuming\n\n");

      const byNumber = new Map<number, Record<string, unknown>>();
      for (const d of knownDays) {
        const n = (d as { dayNumber?: unknown }).dayNumber;
        if (typeof n === "number") byNumber.set(n, d);
      }

      const failedDays: number[] = [];
      if (missing.length > 0) {
        const rosterJson = JSON.stringify(roster);
        const takenList = rs?.takenList ?? [];
        const planFindings = rs?.planFindings ?? [];
        const limit = makeLimiter(8);
        const slices = chunkDayNumbers(missing, roster.length);
        console.log(`[resume] writing ${missing.length} day(s) across ${slices.length} call(s) for job ${jobId}`);

        const results = await Promise.all(slices.map(dayNumbers =>
          limit(async () => {
            const label = `resume_day${dayNumbers.join("+")}`;
            const result = await callAnthropicJson({
              apiKey: ANTHROPIC_API_KEY!,
              system: rs!.systemBlocks as unknown[],
              userContent: [
                ...(Array.isArray(rs!.researchBlocks) ? rs!.researchBlocks as unknown[] : []),
                {
                  type: "text",
                  text: buildSliceInstruction({
                    userPrompt: rs!.userPrompt!,
                    sharedPlanJson: rs!.sharedPlanJson!,
                    rosterJson,
                    dayNumbers,
                    takenList,
                    findings: findingsForDays(planFindings, dayNumbers),
                  }),
                },
              ],
              toolName: DAYS_TOOL.name,
              maxTokens: 2000 * dayNumbers.length + 1500,
              label,
            });
            costs.addAnthropic(`day_slice_${label}`, MODEL, result.usage);
            const parsed = result.data as { days?: unknown[] };
            return { dayNumbers, days: Array.isArray(parsed.days) ? parsed.days as Record<string, unknown>[] : [] };
          }).catch((err: unknown) => {
            console.error(`[resume] slice ${dayNumbers.join("+")} failed:`, err);
            return { dayNumbers, days: [] as Record<string, unknown>[] };
          })
        ));

        for (const r of results) {
          const produced = new Map<number, Record<string, unknown>>();
          r.days.forEach((d, idx) => {
            const claimed = (d as { dayNumber?: unknown }).dayNumber;
            const key = typeof claimed === "number" ? claimed : r.dayNumbers[idx];
            if (typeof key === "number" && !produced.has(key)) produced.set(key, d);
          });
          for (const n of r.dayNumbers) {
            const raw = produced.get(n);
            const entry = roster[n - 1];
            if (raw && Array.isArray((raw as { periods?: unknown }).periods)) {
              byNumber.set(n, {
                ...raw,
                dayNumber: n,
                title: (raw as { title?: string }).title || entry?.title || `Day ${n}`,
                location: (raw as { location?: string }).location || entry?.location || "",
              });
            } else {
              failedDays.push(n);
              byNumber.set(n, {
                dayNumber: n,
                title: entry?.title ?? `Day ${n}`,
                location: entry?.location ?? "",
                ...(entry?.transitNote ? { transitNote: entry.transitNote } : {}),
                periods: [],
                generationFailed: true,
              });
            }
          }
        }
      }

      const allDays = [...byNumber.values()]
        .sort((a, b) => ((a.dayNumber as number) ?? 0) - ((b.dayNumber as number) ?? 0));

      const tail = { ...fullTail } as Record<string, unknown>;
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

      await emit('{"days":' + JSON.stringify(allDays));
      const tailJson = JSON.stringify(tail);
      await emit(tailJson.length > 2 ? "," + tailJson.slice(1) : "}");
      await forward("data: [DONE]\n\n");

      await supabaseAdmin.from("itinerary_jobs").update({
        status: "complete",
        content: emitted,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      // Keep the private copy current. resume_state stays only while days are
      // still missing, so a retry can finish the job.
      await supabaseAdmin.from("itinerary_jobs_private").upsert({
        job_id: jobId,
        content: JSON.stringify({ days: allDays, ...fullTail }),
        resume_state: failedDays.length > 0 ? priv.resume_state : null,
        updated_at: new Date().toISOString(),
      });

      void persistCost(costs, {
        function_name: "generate-itinerary",
        batch_id: completeBatchId,
        job_id: jobId,
        mode: "resume_unlock",
        day_count: roster.length || allDays.length,
        user_id: userId,
      });
      console.log(`[resume] done in ${Date.now() - t0}ms: wrote ${missing.length - failedDays.length}/${missing.length} day(s)` +
        (failedDays.length ? `, failed: ${failedDays.join(",")}` : "") +
        (clientConnected ? "" : " (client disconnected)"));
    } catch (err) {
      console.error("[resume] error:", err);
      void persistCost(costs, {
        function_name: "generate-itinerary",
        batch_id: completeBatchId,
        job_id: jobId,
        mode: "resume_error",
        user_id: userId,
      });
      await supabaseAdmin.from("itinerary_jobs").update({
        status: "error",
        error: String(err).slice(0, 2000),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  try {
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil(pump);
  } catch { /* not available — pump runs inline */ }

  return new Response(readable, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

serve(async (req) => {
  // The payment endpoints ride along as sub-routes of this function because
  // the deploy workflow only ships generate-itinerary, and workflow-file
  // edits need a GitHub scope the automation tokens don't have. The
  // standalone functions (create-checkout-session, confirm-checkout,
  // stripe-webhook) are thin wrappers over these same handlers for whenever
  // they get deployed in their own right. Ordinary generation requests hit
  // /generate-itinerary with no sub-path and fall through untouched.
  const subRoute = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (subRoute === "create-checkout-session") return handleCreateCheckoutSession(req);
  if (subRoute === "confirm-checkout") return handleConfirmCheckout(req);
  if (subRoute === "stripe-webhook") return handleStripeWebhook(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Tracked outside the try so the catch below can mark a registered job failed
  // rather than leaving it pending for reconnecting clients to poll.
  let registeredJobId: string | undefined;

  // Set once the caller is resolved; read by finalizeCosts, which is defined
  // before resolution happens.
  let callerUserId: string | null = null;

  // Phase timings. Generation is slow and we have been guessing at which stage
  // owns the wall clock; every phase below reports its own duration so a single
  // log line per request tells us where the time actually goes.
  const t0 = Date.now();
  const timings: Record<string, number> = {};

  // Dollar accounting for every model call this request makes. Token counts
  // already existed in scattered log lines; what they never answered is what a
  // trip costs to produce, which is the number pricing has to be set against.
  const costs = new CostTracker();
  const finalizeCosts = (meta: {
    mode: string;
    dayCount?: number | null;
    theme?: string | null;
    grounded?: boolean | null;
    batchId?: string | null;
    jobId?: string | null;
  }) => {
    const s = costs.summary();
    console.log("[cost] summary " + JSON.stringify({
      ...s,
      mode: meta.mode,
      day_count: meta.dayCount ?? null,
      usd_per_day: meta.dayCount ? Math.round((s.total_usd / meta.dayCount) * 1e6) / 1e6 : null,
      theme: meta.theme ?? "default",
    }));
    // Fire-and-forget: a cost row must never delay or fail the response.
    void persistCost(costs, {
      function_name: "generate-itinerary",
      batch_id: meta.batchId ?? null,
      job_id: meta.jobId ?? null,
      theme: meta.theme ?? null,
      day_count: meta.dayCount ?? null,
      mode: meta.mode,
      grounded: meta.grounded ?? null,
      user_id: callerUserId,
    });
  };
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

    const { preferences, themeVariant, jobId, batchId, completeBatchId } = validationResult.data;
    registeredJobId = jobId;

    // Which signed-in user (if any) this request belongs to. Attribution for
    // normal generations; hard requirement for resume.
    const userId = await resolveUserId(req);
    callerUserId = userId;

    // Resume-on-unlock takes its own path: no research, no planning, no job
    // registration — just the locked days of an existing job.
    if (completeBatchId) {
      return await handleResume({ jobId, completeBatchId, userId });
    }

    if (!preferences) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: [{ field: "preferences", message: "Required" }] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Received preferences:", JSON.stringify(preferences, null, 2));
    console.log("Theme variant:", themeVariant || "default");
    if (userId) console.log("Caller user_id:", userId);

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
        user_id: userId,
        updated_at: new Date().toISOString(),
      });
      if (jobError) console.error("Failed to register itinerary job:", jobError);
    }

    const { tier, paywalled } = await resolveTier({
      batchId: batchId ?? jobId ?? null,
      jobId,
      themeId: themeVariant?.id ?? null,
      userId,
    });
    if (paywalled) {
      // A purchaser out of credits. Close out the just-registered job so
      // nothing polls a row that will never complete.
      if (jobId) {
        await supabaseAdmin.from("itinerary_jobs").update({
          status: "error",
          error: "payment_required",
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      }
      return new Response(
        JSON.stringify({ error: "payment_required" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (tier !== "full") console.log(`[gate] tier: ${tier}`);

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

    // Optional, unlike the two keys above: without it, dining grounds on web
    // research alone (the pre-Places behavior) — see fetchDiningPlaces.
    const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim();

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
    // READING THE REQUEST
    // ============================================
    // What separates a planned trip from a generated one is mostly not the
    // establishment names — it is that someone read the request closely enough
    // to know what this person would find disappointing. That reading has to
    // happen before anything else, because it decides what gets left out, and
    // leaving things out is where taste lives.
    //
    // This pass does not pick sources. An earlier version did, and it was the
    // wrong lever twice over: the model already knows an alpine club beats a
    // tourism board on snowpack, and a directive naming sources competes with
    // the actual question for retrieval. What the model cannot supply on its
    // own is this traveler's standard for a vague word, so that is what is
    // asked for here.
    //
    // Kicked off before destination resolution and awaited after it: this
    // describes the shape of the trip, not the place, so it neither needs the
    // resolved destination nor should wait behind it.
    type SourcePlan = {
      tripCharacter?: string;
      interpretations?: string[];
      avoid?: string[];
    };

    const sourcePlanPromise: Promise<SourcePlan | null> = timePhase("request_reading", async () => {
      try {
        const strategyPrompt = `Read this travel request the way an experienced human travel planner would before doing any research — not to plan the trip, but to work out what this particular person is actually asking for.

Three things:

1. **What kind of trip is this really?** One concrete sentence. "A first trip abroad with an anxious parent" and "a self-guided traverse by someone who hikes every weekend" produce completely different itineraries to the same destination.

2. **Restate their subjective words as tests.** "Off the beaten path", "authentic", "hidden gem", "local", "chill", "romantic", "epic" are useless as search terms — every listicle claims all of them. Say what each would have to mean for a place to qualify on THIS trip, judged relative to the destination rather than in the abstract. Empty array if they used none.

3. **What would make this itinerary feel canned to THIS person?** Name the obvious inclusions that would signal nobody read their request — the specific landmark, the kind of restaurant, the pacing mistake. Be concrete enough that a planner could check a draft against it.

The traveler's request:
- What they described: ${additionalNotes || "Not specified"}
- Atmosphere: ${atmosphere?.join(", ") || "no preference"}
- Interests (ranked): ${interests?.join(" > ") || "no preference"}
- Adventure level: ${adventureLevel || "no preference"}
- Guided vs self-serve: ${guidedLabel}
- Food & drink: ${foodDrink?.join(", ") || "no preference"}
- Budget: ${budgetInfo.label} (${budgetInfo.accommodation})
- Duration: ${durationContext}
- Timing: ${dateContext}
${themeVariant?.name ? `- Itinerary theme: ${themeVariant.name}` : ""}

Respond with ONLY a JSON object in this shape:
{
  "tripCharacter": "one concrete sentence",
  "interpretations": ["each subjective word restated as a test a place must pass"],
  "avoid": ["specific things that would read as generic to this traveler"]
}

Worked example, for "hut to hut, no driving, want to get away from the crowds" — six days, self-guided, active:
{
  "tripCharacter": "A self-guided six-day mountain traverse sleeping in huts, by someone fit enough to carry a pack who is specifically trying to get away from day-trip crowds.",
  "interpretations": ["'Away from the crowds' here means huts and valleys the cable-car day-trippers cannot reach on foot in an afternoon — not simply places less famous than the headline peak. A place qualifies if reaching it costs a half day of walking, or a connection the tour buses do not run."],
  "avoid": ["The photographed viewpoint ten minutes from a cable car station — it is the most crowded spot in the range and its presence would prove nobody read the request.", "A rest day parked in a resort town; this traveler wants the walking, not the shopping street.", "Restaurants in valley towns the route never descends into."]
}

No explanation. Just the JSON object.`;

        const strategyResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5",
            messages: [{ role: "user", content: strategyPrompt }],
            // Seven topic directives plus the interpretations run long.
            max_tokens: 1200,
          }),
        });

        if (!strategyResponse.ok) {
          console.error("Source strategy pass failed:", strategyResponse.status);
          return null;
        }

        const strategyData = await strategyResponse.json();
        costs.addAnthropic("request_reading", "claude-haiku-4-5", strategyData.usage);
        const raw = strategyData.content?.[0]?.text?.trim() ?? "";
        const parsed = JSON.parse(raw.replace(/```[a-z]*\n?/gi, "").trim());

        // Clamp before this reaches a query: the directives are concatenated
        // into every Perplexity prompt, and a runaway generation here would
        // bury the actual question underneath its own sourcing advice.
        const clamp = (s: unknown, max: number) =>
          typeof s === "string" && s.trim() ? s.trim().slice(0, max) : undefined;

        const strList = (v: unknown, max: number, cap: number) =>
          Array.isArray(v) ? v.map((i: unknown) => clamp(i, max)).filter(Boolean).slice(0, cap) as string[] : [];

        const plan: SourcePlan = {
          tripCharacter: clamp(parsed?.tripCharacter, 300),
          interpretations: strList(parsed?.interpretations, 500, 4),
          avoid: strList(parsed?.avoid, 300, 5),
        };
        console.log("Request reading:", JSON.stringify(plan, null, 2));
        return plan;
      } catch (err) {
        console.error("Source strategy pass failed — using baseline sourcing only:", err);
        return null;
      }
    });

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
          costs.addAnthropic("destination_resolution", "claude-haiku-4-5", resolutionData.usage);
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

    // Started before destination resolution; collected here.
    const sourcePlan = await sourcePlanPromise;

    // Which sources are worth reading is something the model already knows; an
    // instruction naming them mostly competes with the question for retrieval,
    // and an earlier version of this ran longer than the questions it was
    // attached to. What the model will not volunteer is where a given number
    // came from — unasked, a departure time arrives with no way to tell the
    // operator's timetable from a blog post six years stale. That is a
    // reporting contract, not knowledge, so it is stated, kept to one sentence,
    // and attached only to the topics carrying facts that expire.
    const SOURCING_CONTRACT = ` For any schedule, fare, fee, permit or opening window, name the operator or authority it came from, and say so when recent first-hand accounts contradict it. Flag anything you found in only one place.`;
    const factualTopics = new Set(['nearbyAndTransport', 'seasonal', 'planning', 'flights']);
    const sourceClause = (key: string) => (factualTopics.has(key) ? SOURCING_CONTRACT : '');

    // Vague words the traveler used, restated as tests. Injected where taste
    // decides the answer — asking a search engine for "hidden gems" returns the
    // pages that call themselves that, which is the opposite of the request.
    const interpretationClause = sourcePlan?.interpretations?.length
      ? ` Apply the following as tests a place must pass, not as phrases to match: ${sourcePlan.interpretations.join(" ")}`
      : "";

    // Keyed so a conditional query can be added without shifting the indices
    // the context block reads from.
    const searchSpecs: { key: string; query: string }[] = [
      // Activities and things to do. Asked for texture rather than a ranking:
      // "best things to do in X" is the query the listicle was written to
      // answer, and it returns the listicle no matter what sources are
      // preferred. What a day is actually like is what an itinerary is built
      // from, and what is overrated is as useful as what is good.
      {
        key: 'activities',
        query: `What is genuinely worth doing in ${destinationStr} for ${interestsStr} travelers, and what is each one actually like to do? For every recommendation: the specific name, what makes it worth the time, the time of day it is best and why, how long it realistically takes including getting there, and what it costs. Then cover two more things: what is overrated here and what people who know the place do instead, and which areas reward an unstructured hour on foot and what you would actually come across in them.${themeStr ? ` Weight this toward ${themeStr}.` : ''} ${budgetInfo.label} budget.${notesClause} Judge how well-trodden something is relative to ${destinationStr} itself — what people who know this place consider the tourist trail — not by how famous it is to an outsider.${interpretationClause}${sourceClause('activities')}`,
      },

      // Restaurants and food scene — emphasise currently operating
      {
        key: 'restaurants',
        query: `Where should someone actually eat in ${destinationStr} for ${foodStr}, confirmed still open and trading as of ${currentYear}? Exclude anything closed, temporarily closed, or of uncertain operating status. For each: the name, the neighborhood, what to order there, what a meal costs, what the room and the crowd are like and which kind of evening it suits, and whether it needs booking and how far ahead. Cover the whole range a traveler on this trip would really use across a week — the everyday place that is good every time and the one worth dressing up for — not a ranked list of the same destination restaurants. Cover ALL THREE MEALS, not only dinner: name the breakfast and coffee places — cafés, bakeries, brunch spots — and the casual lunch stops, as well as the dinner rooms. An itinerary needs somewhere real to eat every morning and midday, and dinner-only coverage cannot fill those slots. ${budgetInfo.label} budget.${tripNotes ? ` The traveler describes the trip as: "${tripNotes}" — if this trip spends nights somewhere without restaurants nearby (a mountain hut, a lodge, a remote village, a boat), say so and name where meals are actually eaten there instead.` : ''}${interpretationClause}${sourceClause('restaurants')}`,
      },

      // Where to sleep, in whatever form this trip actually needs
      {
        key: 'accommodation',
        query: `Where should someone stay in ${destinationStr} at ${budgetInfo.label} level, ${budgetInfo.accommodation}? ${startDate && endDate ? `For dates: check-in ${startDate}, check-out ${endDate}.` : targetMonth ? `For travel in ${targetMonth}.` : ''} For each: the specific name, the nightly rate, exactly where it sits and what that means for getting around, what it is actually like to stay there, what the immediate area is like in the evening, and what a night includes.${tripNotes ?` The traveler describes the trip as: "${tripNotes}" — include the kinds of lodging this trip actually requires (for example mountain huts or refuges, guesthouses, campsites, lodges, hostels, ryokan), not only conventional hotels, and note how each is booked and what a night includes such as half board.` : ''}${interpretationClause}${sourceClause('accommodation')}`,
      },

      // Where the trip goes and how it moves. Deliberately not branched on
      // whether the destination is one city: a region resolves to a single
      // string too, and the old branch then asked what to visit *outside* an
      // area the whole trip happens inside. One question covers both shapes.
      {
        key: 'nearbyAndTransport',
        query: `For a ${tripDaysNum}-day trip in ${destinationStr}: which places should the itinerary actually include, how do you travel between them (trains, buses, cable cars, ferries, driving — with prices and journey times), and how many days does each deserve? If this is a single city, cover what is worth leaving it for as day trips or overnight stops. If it is a region or a route, cover how to move between its towns and valleys, and whether it works better as a base with day trips or as a point-to-point traverse. For each move, say what it actually costs in usable hours once you count getting to the station and waiting for the connection, and whether it is worth doing at all for a stay that short.${notesClause}${sourceClause('nearbyAndTransport')}`,
      },

      // Seasonal & practical information
      {
        key: 'seasonal',
        query: `${destinationStr} travel in ${targetMonth || 'the travel season'}. Include weather, peak vs off-season pricing, festivals or events, crowd levels, and any seasonal closures.${notesClause}${sourceClause('seasonal')}`,
      },

      // Planning, booking windows, access rules, conditions and required skill.
      // These are the details that decide whether a trip is possible at all,
      // and none of the queries above ask about them.
      {
        key: 'planning',
        query: `Practical planning for a ${tripDaysNum}-day trip in ${destinationStr}${targetMonth ? ` in ${targetMonth}` : ''}${tripNotes ? `, described by the traveler as: "${tripNotes}"` : ''}. Answer each of these specifically for ${currentYear}: (1) How far in advance do the places to stay need to be booked, and how is each one booked — online, by email, deposit required, cash only? (2) What permits, reservations, entry fees, timed-entry slots, or vehicle and access restrictions apply, and how are they obtained? (3) What conditions, closures, or seasonal limits affect this trip, and what is the usable window? (4) What fitness or skill level, equipment, and guiding does it require, and where locally can equipment be rented or a guide hired, at what price?${sourceClause('planning')}`,
      },
    ];

    // Flight estimates (conditional)
    if (!noFlight && departureCity) {
      searchSpecs.push({
        key: 'flights',
        query: `Flights from ${departureCity} to ${destinationStr} in ${targetMonth || 'upcoming months'}. Which airports actually serve this destination — if it is a region rather than a city, name the realistic gateway airports and how far each is from it by road or rail. Include typical price ranges, best airlines, flight duration, and whether nonstop options exist.${sourceClause('flights')}`,
      });
    }

    // Run the searches in parallel, but stagger the launches. Firing all six at
    // the same instant is what tripped Perplexity's rate limit — five came back
    // 429 in milliseconds, so the itinerary was built on one search out of six.
    // The ramp has to be wide enough that the FIRST attempt lands. 180ms apart
    // put all seven inside ~1.3s and everything 429'd; 700ms got every search
    // through, but only by retrying — the phase went from 11.9s to 34.7s, and
    // all of that was backoff. Retrying past a rate limit is far more expensive
    // than simply not tripping it, so the ramp is wider than feels necessary.
    // Watch for `[research] ... retrying` in the logs: none means this is right.
    console.log(`Executing ${searchSpecs.length} Perplexity research queries...`);
    // Places runs alongside the web research: it answers from a different
    // corpus (the live Maps database) and shares no rate limit with
    // Perplexity, so the two phases overlap instead of stacking.
    const placesPromise = timePhase("places_dining", () =>
      fetchDiningPlaces(resolvedCities, GOOGLE_PLACES_API_KEY, foodDrink ?? []));
    const results = await timePhase("perplexity_research", () =>
      Promise.all(searchSpecs.map(async (spec, i) => {
        if (i > 0) await new Promise(r => setTimeout(r, i * 1500));
        return searchWithPerplexity(spec.query, PERPLEXITY_API_KEY, spec.key).then(r => {
          if (r.usage) costs.addPerplexity(`research_${spec.key}`, "sonar", r.usage);
          return r;
        });
      })));
    const { dining: placesDining, requests: placesRequests } = await placesPromise;
    costs.addGooglePlaces("places_dining", placesRequests);
    console.log("[research] places dining: " + JSON.stringify(
      placesDining.map(d => ({
        city: d.city,
        ...Object.fromEntries(Object.entries(d.meals).map(([meal, ps]) => [meal, ps.length])),
      }))));

    type ResearchResult = { content: string; citations: string[] };
    const research: Record<string, ResearchResult | undefined> = {};
    searchSpecs.forEach((spec, i) => { research[spec.key] = results[i]; });

    // Every search failing returns empty content rather than throwing, so the
    // research block can assemble into nothing but section headers. Left
    // unchecked the model is then handed "ONLY recommend places that appear in
    // the research" alongside no research at all — contradictory instructions
    // that it can only resolve by inventing establishments and URLs, which is
    // the exact failure the rules were written to prevent.
    const hasWebResearch = results.some(r => r.content.trim().length > 0);
    const hasPlacesDining = placesDining.length > 0;
    // Places data is grounding too: even with every web search empty, a dining
    // list straight from the Maps database is real research to hold the model
    // to, so the strict "only from the research" regime stays on.
    const hasGroundedResearch = hasWebResearch || hasPlacesDining;
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
    console.log(`Perplexity research completed. grounded=${hasGroundedResearch} (web=${hasWebResearch} places=${hasPlacesDining})`);
    if (!hasWebResearch) {
      console.error("All Perplexity searches returned empty" +
        (hasPlacesDining ? " — grounding on Places dining data only." : " — generating without grounding."));
    }

    const activitiesResearch = research.activities;
    const restaurantsResearch = research.restaurants;
    const accommodationResearch = research.accommodation;
    const nearbyAndTransportResearch = research.nearbyAndTransport;
    const seasonalResearch = research.seasonal;
    const planningResearch = research.planning;
    const flightResearch = research.flights; // Undefined when no flight query ran

    // The provenance is worth more to the traveler than it is to the model.
    // A departure time the itinerary took from an operator's own timetable and
    // one it took from a 2019 blog post look identical on the page, and only
    // one of them is worth planning a morning around — so the citations that
    // grounded each topic are returned alongside the itinerary rather than
    // being consumed and discarded. Deduped, because a single operator page
    // routinely answers several of the questions.
    const SOURCE_TOPIC_LABELS: Record<string, string> = {
      activities: "Things to do",
      restaurants: "Food & drink",
      accommodation: "Places to stay",
      nearbyAndTransport: "Getting around",
      seasonal: "Season & timing",
      planning: "Booking & access",
      flights: "Flights",
    };
    const researchSources = searchSpecs
      .map(spec => ({
        topic: SOURCE_TOPIC_LABELS[spec.key] ?? spec.key,
        citations: Array.from(new Set(research[spec.key]?.citations ?? []))
          .filter(c => typeof c === "string" && /^https?:\/\//i.test(c))
          .slice(0, 8),
      }))
      .filter(s => s.citations.length > 0);
    if (hasPlacesDining) {
      // The top Maps listing per meal per city — the links a traveler would
      // actually tap to check a place — under the same topic cap as the rest.
      const mapsCitations = Array.from(new Set(
        placesDining
          .flatMap(d => MEAL_GROUPS.map(meal => d.meals[meal]?.[0]?.mapsUrl))
          .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)),
      )).slice(0, 8);
      if (mapsCitations.length > 0) {
        researchSources.push({ topic: "Dining (Google Maps)", citations: mapsCitations });
      }
    }
    console.log(`Research sources: ${researchSources.reduce((n, s) => n + s.citations.length, 0)} across ${researchSources.length} topic(s)`);

    const citeList = (r: ResearchResult | undefined) =>
      r?.citations?.length ? r.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available';

    // The dining backbone, rendered for the prompt. Grouped by city and meal
    // period so the skeleton can fill a Morning slot by reading the Breakfast
    // list for wherever that day is — the lookup it actually performs. The
    // well-known/quieter-find labels are the levers for choosing on fit.
    const formatDiningPlace = (p: DiningPlace) =>
      `- ${p.name} — ${p.rating}★ (${p.ratingCount.toLocaleString("en-US")} reviews, ` +
      `${p.wellKnown ? 'well-known' : 'quieter find'})` +
      `${p.price ? `, ${p.price}` : ''}${p.address ? `, ${p.address}` : ''}${p.mapsUrl ? ` — ${p.mapsUrl}` : ''}`;
    const placesDiningContext = hasPlacesDining ? `
### 📍 DINING FROM GOOGLE MAPS (live Places data)

Every establishment below is listed as currently operating on Google Maps, with its live rating and review count. These are grounded names: assigning one to a matching meal period is correct even when the web research above never mentions it. "Local favorites" holds places that surfaced for being loved rather than being famous — assign those to whichever meal they plausibly serve.

**Choose for FIT, not fame.** A review count measures how trafficked a place is, not how good it is, and the traveler could find the most-reviewed name themselves in a two-second Maps search. Each list mixes well-known picks with equally-rated quieter finds — read the traveler's food & drink preferences and the trip's character, and take the entry that fits them; where a quieter find and a well-known one would both do, the quieter one is usually the better recommendation. The same goes for the web research above: where it surfaces a strong, current place that fits this trip, prefer it over the obvious Maps pick.

Where the web research covers a place listed here, use it for texture — what to order, whether to book. Where it is silent, describe the place by its meal, price level and neighborhood rather than inventing specifics. Use each entry's Google Maps link as its url.

${placesDining.map(d => `**${d.city}**
${MEAL_GROUPS.map(meal => {
  const rows = d.meals[meal] ?? [];
  return rows.length ? `${meal}:\n${rows.map(formatDiningPlace).join('\n')}` : '';
}).filter(Boolean).join('\n')}`).join('\n\n')}

---
` : '';

    const groundedResearchContext = `
## GROUNDED RESEARCH DATA (From Live Web Search)

**CRITICAL INSTRUCTIONS:** The following is retrieved from live web search — treat it as FACTUAL GROUNDING.
- ONLY recommend places, activities, and restaurants that appear in this research
- Do NOT hallucinate establishment names or URLs
- For anything not in the research, use the fallback URL patterns in the system prompt
- The research states where its claims came from. Carry that through: name the operator behind a schedule, and keep the distinction between what is published and what travelers actually report.
- The research is deliberately wider than one itinerary needs. Do not work through it — choose from it, and leave most of it unused.
${sourcePlan?.tripCharacter ? `\n**What this trip is:** ${sourcePlan.tripCharacter}\n` : ''}${sourcePlan?.avoid?.length ? `
**What would make this itinerary feel canned to this traveler** — read before selecting, and check your draft against it:
${sourcePlan.avoid.map(a => `- ${a}`).join('\n')}

Including one of these anyway is a defensible call if the trip genuinely needs it, but then say why in the activity's description rather than presenting it as an ordinary pick.
` : ''}
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
${placesDiningContext}
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

You have been provided with LIVE WEB SEARCH RESULTS at the start of the user message below. This is your FACTUAL GROUND TRUTH. Where it attributes a claim — an operator behind a timetable, an authority behind a fee — that attribution is part of the fact and travels with it.

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
9. **The research attributes its claims, and sometimes reports a conflict** — a published timetable saying one thing and recent travelers saying another. Do not silently pick one or split the difference. Plan on the more conservative of the two, and put the discrepancy in summary.assumptions or the relevant transitNote so the traveler knows to confirm it. Anything the research flagged as found in only one place is a soft fact: state it as such rather than as a schedule to build a day around.`
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

Call the \`emit_trip_plan\` tool. Its input takes these fields — and **there is NO "days" key**: writing out the days here is the one thing this pass must not do.

{
  "dayPlan": [
    {
      "dayNumber": 1,
      "title": "Arrival and Ponta Delgada",
      "location": "Ponta Delgada",
      "area": "city center and marina",
      "anchors": ["Portas da Cidade square", "Mercado da Graça market", "Sunset at the marina"],
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
- **area is the one neighborhood, zone or valley the day clusters in** — a few words. A day lives in its area. Sequence the days so the trip flows through the destination: consecutive days sit in adjacent areas or along the route, and once the trip leaves an area it does not double back (returning to the gateway for departure is the exception). This ordering cannot be fixed later — the day passes write days independently and cannot move them.
- **anchors are the 2-4 activities that define the day** — short names copied from the research, each with a word on where it sits (e.g. "Jerónimos cloisters, Belém"). THIS IS ALSO WHERE ACTIVITY UNIQUENESS IS DECIDED: the day passes cannot see each other's days, so an activity that anchors two days will be written twice. Before finishing, read back over the whole array exactly as with restaurants — no anchor may repeat across days, and every anchor must sit in or near its day's area.
- **dining holds the ASSIGNED RESTAURANT NAMES for that day's three periods — names only.** No descriptions, no prices, no URLs; pass 2 writes those from the research.
- **EVERY ENTRY MUST BE A REAL ESTABLISHMENT'S PROPER NAME, copied from the research.** "Ristorante Il Cavatappi", "Osteria del Beccaccino", "Bar Il Molo" are names. "Trattoria in Varenna village", "Dinner at a lakeside ristorante", "a family-run osteria", "Lakefront café" are CATEGORY DESCRIPTIONS, not names. A category description is never acceptable — not as a top pick, not as a second option, not to complete a day. It is the same failure as inventing a restaurant, and it is worse than leaving the slot empty, because the traveler is handed a search box instead of a table.
- **RUNNING OUT OF NAMES IS AN ACCEPTABLE OUTCOME. PADDING IS NOT.** If the research does not contain enough named establishments to fill every period, leave the extra periods out — give an empty array, or omit the period key. A trip with nine real named restaurants and twelve empty slots is correct. A trip with twenty-one filled slots where half are categories is a failure. Note the shortfall in summary.assumptions.
${hasPlacesDining ? `- **THE RESEARCH INCLUDES A "DINING FROM GOOGLE MAPS" SECTION** with confirmed-operating places grouped by city and meal period. Draw on it directly — its Breakfast lists exist precisely because web articles skip breakfast. For any day spent in a city that section covers, fill every period with a real name from it or from the web research; an empty period there is a shortfall, not caution. Leave a period empty only where the traveler is genuinely out of reach of restaurants — a hut, a boat, a remote trail — or the lists for that place are exhausted.
- **CHOOSE DINING FOR FIT, NOT FAME.** Each Maps list labels its entries well-known or quieter find. Do not default to the most-reviewed name: match the traveler's food & drink preferences and the trip's character, and where a quieter find or a place from the web research fits as well as the obvious pick, take it — the traveler could have found the famous one in a two-second Maps search; the quieter one is the recommendation they came for. Use the well-known names where reliability is what the day needs: the first meal after landing, a night when everything else is closed, a group that wants safe.` : ''}
- Give 1 or 2 names per period. The first is the top pick. Add a second ONLY when a real, separate alternative exists within reach of where the traveler actually is at that hour — one real option beats two where the second is filler.
- **THIS IS WHERE RESTAURANT UNIQUENESS IS DECIDED, AND IT CANNOT BE FIXED LATER.** The day passes run independently and cannot see each other's choices. Before you finish, read back over the entire dayPlan: if the same establishment appears on two different days, or twice in one day, replace one of them with a different place from the research.
- The ONLY name that may legitimately repeat is a stay's own dining room — a hut, refuge, lodge, ryokan, safari camp, boat, or hotel where meals are included or nothing else is within reach. Where that is genuinely where the traveler eats, repeat it and say which stay it is.
- Every name must come from the grounded research, or be the traveler's own lodging for that night. Never invent one to fill a slot.
- **ASSIGN EACH MEAL WHERE THE TRAVELER WILL BE AT THAT HOUR.** The day's area and anchors say where that is, and the research and Places lists carry each restaurant's neighborhood or address — read them. A meal beside the day's anchors is the right assignment; a famous name across town is the wrong one, however good. This is how a local plans a day, and it cannot be fixed later either.
- Match the meal to the period (Morning = breakfast, Afternoon = lunch, Evening = dinner), and vary cuisine and vibe day to day — within reach of each day's area, never at the cost of proximity.

Put all of this in the \`emit_trip_plan\` tool call. Do not write the itinerary out as text.`;

    type DayPlanEntry = {
      dayNumber?: number;
      title?: string;
      location?: string;
      area?: string;
      anchors?: string[];
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
      // Streaming splits usage across events: message_start carries the input
      // side, the final message_delta the cumulative output. Accumulated here
      // and recorded once the stream ends.
      let singleCallUsage: Record<string, number> = {};
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
                singleCallUsage = { ...singleCallUsage, ...u };
              }
              if (event.type === "message_delta" && event.usage?.output_tokens) {
                singleCallUsage.output_tokens = event.usage.output_tokens;
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
            // Forcing the plan tool is what makes the roster structurally
            // unskippable: the cached system prompt describes a "days" array at
            // length, and left to prose the model writes that instead and drops
            // the request onto the slow single-call path.
            toolName: TRIP_PLAN_TOOL.name,
            // Headroom for the per-day area + anchors the roster now carries;
            // a cap a long trip can reach would truncate the plan mid-tool-call.
            maxTokens: 9000,
            label: "skeleton",
          });
          timings.skeleton_generation = Date.now() - skeletonStart;
          skeletonTokens = skeletonResult.outputTokens;
          costs.addAnthropic("skeleton", MODEL, skeletonResult.usage);
          console.log(`[timing] skeleton_generation: ${timings.skeleton_generation}ms`);

          const parsed = skeletonResult.data as Skeleton;
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
        let skeleton = splitGenerationEnabled ? await trySkeleton() : null;

        if (!skeleton) {
          if (tier !== "full") {
            // The single-call fallback streams the whole itinerary in one
            // unredacted pass — a preview must never take it. Fail the job
            // instead; the client's retry path handles the rest. (This also
            // means ITINERARY_SPLIT_GENERATION=off and PAYWALL=on cannot be
            // combined for free users.)
            throw new Error("Generation failed before day planning — please retry");
          }
          await runSingleCall();
          costs.addAnthropic("single_call", MODEL, singleCallUsage);
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
          finalizeCosts({ mode: "single_call", theme: themeVariant?.id, grounded: hasGroundedResearch, batchId, jobId });
          await persistComplete();
          return;
        }

        // The plan pass wrote the finished days rather than a roster. Emit them
        // and stop — there is nothing left for pass 2 to do, and this costs one
        // call instead of the two the fallback used to spend.
        const skeletonDays = Array.isArray(skeleton.days) ? skeleton.days : [];
        if ((skeleton.dayPlan?.length ?? 0) === 0 && skeletonDays.length > 0) {
          const fullTail: Record<string, unknown> = {};
          for (const key of ["summary", "budget", "flights", "accommodation", "bookingChecklist", "alternatives"]) {
            if (skeleton[key] !== undefined) fullTail[key] = skeleton[key];
          }
          if (researchSources.length) fullTail.sources = researchSources;

          // Preview tiers: days past the free limit exist here in full, so the
          // real content is persisted privately and only title-level
          // placeholders are emitted. Resume simply replays the private copy.
          const freeLimit = tier === "full" ? skeletonDays.length
            : tier === "preview_primary" ? Math.min(FREE_PRIMARY_DAYS, skeletonDays.length)
            : 0;
          const emittedDays = skeletonDays.map((raw, i) => {
            const day = (raw ?? {}) as Record<string, unknown>;
            const dayNumber = typeof day.dayNumber === "number" ? day.dayNumber : i + 1;
            if (i < freeLimit) return { ...day, dayNumber };
            return {
              dayNumber,
              title: typeof day.title === "string" ? day.title : `Day ${dayNumber}`,
              location: typeof day.location === "string" ? day.location : "",
              ...(typeof day.transitNote === "string" ? { transitNote: day.transitNote } : {}),
              periods: [],
              locked: true,
            };
          });

          const tail: Record<string, unknown> = { ...fullTail };
          if (tier !== "full") {
            const { visible, lockedCounts } = redactChecklist(fullTail.bookingChecklist, tier);
            if (fullTail.bookingChecklist !== undefined) tail.bookingChecklist = visible;
            tail.access = {
              tier,
              lockedDayCount: emittedDays.length - freeLimit,
              lockedBookingCounts: lockedCounts,
            };
            if (jobId) {
              const { error: privError } = await supabaseAdmin.from("itinerary_jobs_private").upsert({
                job_id: jobId,
                content: JSON.stringify({ days: skeletonDays, ...fullTail }),
                resume_state: null,
                updated_at: new Date().toISOString(),
              });
              if (privError) console.error("Failed to persist private job state:", privError);
            }
          }

          const tailJson = JSON.stringify(tail);
          await emit('{"days":' + JSON.stringify(emittedDays));
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
          finalizeCosts({ mode: tier === "full" ? "skeleton_complete" : `skeleton_complete_${tier}`, dayCount: skeletonDays.length, theme: themeVariant?.id, grounded: hasGroundedResearch, batchId, jobId });
          await persistComplete();
          return;
        }

        // ── Read the plan back before writing it out ──────────────────────
        // A planner reads their own draft before committing to it, and the
        // roster is the only thing there is to read: days stream to the client
        // as they finish, so by the time day three exists it has already been
        // sent. Pacing, sequencing, what got included and what got missed are
        // all decided here anyway.
        //
        // The findings do NOT go back through a second plan pass. That was the
        // first design and it could not fit: the plan call costs ~77s of a
        // ~150s wall clock, so regenerating it lands the request at ~197s
        // before a single day is written, and production duly timed out with
        // the revision in flight. Findings go to the day writers instead —
        // they choose each day's activities, so "day 1 is too packed after a
        // train journey" is theirs to act on, and routing it there costs no
        // wall clock at all rather than a second plan.
        //
        // Haiku, because noticing a problem is recognition rather than
        // authorship. Fails open at every step: any error, any unparseable
        // answer, or a request already too far into its budget, and the plan
        // proceeds unreviewed.
        const reviewPlan = async (current: Skeleton): Promise<string[]> => {
          const plan = current.dayPlan ?? [];
          if (plan.length === 0) return [];

          // The review is worth ~11s only while there is time left to write the
          // days it comments on. Past this point the days are what matter, and
          // a review that pushes them over the wall costs the traveler the
          // whole itinerary to improve a plan they will never see.
          const elapsed = since(t0);
          if (elapsed > REVIEW_BUDGET_CUTOFF_MS) {
            console.warn(`[critique] skipped — ${Math.round(elapsed / 1000)}s elapsed of a ` +
              `${Math.round(WALL_CLOCK_BUDGET_MS / 1000)}s budget, leaving the time to the days`);
            return [];
          }

          try {
            // area and anchors give the repetition and geography checks real
            // substance — on titles alone the review could only catch
            // title-level repeats.
            const rosterForReview = plan.map((e, i) => ({
              day: i + 1,
              title: e.title,
              location: e.location,
              area: e.area,
              anchors: e.anchors,
              transitNote: e.transitNote,
            }));

            // Deliberately not the whole userInputsBlock. The review needs what
            // the traveler wanted, not every field they filled in, and the
            // prompt is on the critical path.
            const critiquePrompt = `You are reading a travel plan before it gets written up, the way a senior planner reads a junior's draft. You are not rewriting it — you are saying what is wrong with it.

The traveler asked for: ${durationContext}, ${budgetInfo.label} budget, ${dateContext}.
Interests: ${interests?.join(" > ") || "none stated"}. Atmosphere: ${atmosphere?.join(", ") || "none stated"}. Adventure level: ${adventureLevel || "none stated"}.
In their words: ${tripNotes || "nothing further"}
${sourcePlan?.tripCharacter ? `What this trip actually is: ${sourcePlan.tripCharacter}` : ""}${sourcePlan?.avoid?.length ? `\n\nThings that would make this feel canned to this traveler:\n${sourcePlan.avoid.map(a => `- ${a}`).join("\n")}` : ""}

The plan, one entry per day:
${JSON.stringify(rosterForReview)}

Look for these specifically:
1. **Pacing** — every day the same intensity, a heavy day scheduled on arrival, a long run with no let-up, or a final day that assumes an evening the traveler does not have.
2. **Geography** — a day whose stops are scattered across the map, or a move that costs more of the day than it gives back.
3. **Fit** — anything on the canned list above, or an inclusion that contradicts something the traveler explicitly asked for.
4. **Omission** — something they said they came for that appears nowhere, or lands so late that one bad weather day would take it from them.
5. **Repetition** — two days that would read almost identically to the person living them.

Report **at most the three most significant** problems, worst first. Each must name its day number and the concrete fix, in ONE sentence of AT MOST 250 characters — anything longer is cut off mid-word before the writer sees it, so edit yourself down rather than being truncated. A plan with nothing wrong is a normal outcome — say so rather than filling the quota.

Every finding will be handed to the writer of that specific day, who chooses that day's activities, their emphasis, and how full the day is — and nothing else. The day's location, title, and restaurants are already fixed and cannot be moved by anyone downstream of you. So "arrive somewhere else", "go to a different town", or "swap this restaurant" are wasted findings that will be ignored; "within Varenna, skip the lakefront promenade and take the chestnut-forest trail above the town instead" is one the writer can act on. Phrase every fix as what to do differently WITHIN where the day already is.

Respond with ONLY JSON:
{"verdict": "ok", "findings": []}
or
{"verdict": "revise", "findings": ["Day 3: ...", "Day 5: ..."]}`;

            const critiqueResponse = await timePhase("plan_critique", () =>
              fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "x-api-key": ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "claude-haiku-4-5",
                  messages: [{ role: "user", content: critiquePrompt }],
                  // Three one-sentence findings. The first cut allowed 900 and
                  // got six sprawling ones back, which cost latency to generate
                  // and then had to be trimmed anyway.
                  max_tokens: 400,
                }),
              }));

            if (!critiqueResponse.ok) {
              console.error("[critique] failed:", critiqueResponse.status);
              return [];
            }
            const critiqueData = await critiqueResponse.json();
            costs.addAnthropic("plan_critique", "claude-haiku-4-5", critiqueData.usage);
            const raw = (critiqueData.content?.[0]?.text ?? "").replace(/```[a-z]*\n?/gi, "").trim();
            const parsed = JSON.parse(raw);
            // A finding that overruns the clamp gets cut at a sentence or word
            // boundary, not mid-word: the first production run shipped
            // "skipping Varen…" and "remove the Bel…" into day-writer prompts,
            // where an amputated instruction reads as noise exactly where it
            // was supposed to read as direction.
            const clampFinding = (f: string): string => {
              const t = f.trim();
              if (t.length <= 300) return t;
              const cut = t.slice(0, 300);
              const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
              if (sentenceEnd > 150) return cut.slice(0, sentenceEnd + 1);
              const wordEnd = cut.lastIndexOf(" ");
              return (wordEnd > 0 ? cut.slice(0, wordEnd) : cut) + "…";
            };
            const findings: string[] = Array.isArray(parsed?.findings)
              ? parsed.findings
                  .filter((f: unknown): f is string => typeof f === "string" && f.trim().length > 0)
                  .map(clampFinding)
                  .slice(0, 3)
              : [];
            if (parsed?.verdict !== "revise" || findings.length === 0) {
              console.log("[critique] plan passed review");
              return [];
            }
            console.log(`[critique] ${findings.length} finding(s):`, JSON.stringify(findings));
            return findings;
          } catch (err) {
            console.error("[critique] skipped:", err);
            return [];
          }
        };

        const planFindings = await reviewPlan(skeleton);

        const dayPlan = skeleton.dayPlan ?? [];
        dayCount = dayPlan.length;

        // Normalise the roster: the day slices are addressed by position, so
        // dayNumber must be 1..N regardless of what the model wrote.
        const roster = dayPlan.map((entry, i) => ({
          dayNumber: i + 1,
          title: typeof entry.title === "string" ? entry.title : `Day ${i + 1}`,
          location: typeof entry.location === "string" ? entry.location : "",
          area: typeof entry.area === "string" ? entry.area : undefined,
          anchors: Array.isArray(entry.anchors)
            ? entry.anchors.filter((a): a is string => typeof a === "string" && a.trim().length > 0).slice(0, 6)
            : undefined,
          transitNote: typeof entry.transitNote === "string" ? entry.transitNote : undefined,
          dining: entry.dining && typeof entry.dining === "object" ? entry.dining : {},
        }));

        // Uniqueness is enforced here, not left to the model — see
        // dedupeRosterDining. The stay's own dining room is exempt.
        const lodgingNames = new Set<string>();
        for (const loc of (skeleton.accommodation as { options?: { name?: string }[] }[] | undefined) ?? []) {
          for (const opt of loc?.options ?? []) {
            if (opt?.name) lodgingNames.add(opt.name.trim().toLowerCase());
          }
        }

        const { assigned: takenList, dropped: droppedDuplicates } =
          dedupeRosterDining(roster, lodgingNames);
        if (droppedDuplicates.length) {
          console.warn(`[quality] dropped ${droppedDuplicates.length} duplicate roster name(s): ` +
            JSON.stringify(droppedDuplicates));
        }

        // Preview tiers write only the free prefix of the roster. Locked days
        // are emitted as title-only placeholders after the loop below, and
        // their prose is generated by resume-on-unlock — never here, never
        // speculatively.
        const freeDayLimit = tier === "full" ? roster.length
          : tier === "preview_primary" ? Math.min(FREE_PRIMARY_DAYS, roster.length)
          : 0;
        const lockedDayNumbers = roster.slice(freeDayLimit).map(d => d.dayNumber);

        const slices = planDaySlices(freeDayLimit);
        sliceCount = slices.length;
        console.log(`[timing] day slices: ${freeDayLimit}/${roster.length} days across ${slices.length} call(s)` +
          (lockedDayNumbers.length ? ` (${lockedDayNumbers.length} locked)` : ""));

        // The assigned names, before any day call has run. If these are already
        // generic ("Trattoria in Varenna village") the skeleton could not find
        // named establishments in the research; if they are real here but
        // generic in the finished itinerary, a day call ignored its assignment.
        // Without this the two failures are indistinguishable from the output.
        const rosterNames = roster.map(d => Object.values(d.dining ?? {}).flat());
        console.log("[quality] roster dining: " + JSON.stringify(rosterNames));

        // Measured after de-duplication, so duplicated should now always be 0.
        // If it is not, the enforcement above has a hole in it.
        const rosterSeen = new Map<string, number>();
        for (const name of rosterNames.flat()) {
          const key = String(name).trim().toLowerCase();
          if (key) rosterSeen.set(key, (rosterSeen.get(key) ?? 0) + 1);
        }
        const rosterDupes = [...rosterSeen.entries()].filter(([, n]) => n > 1);
        console.log(`[quality] roster uniqueness: slots=${rosterNames.flat().length} ` +
          `unique=${rosterSeen.size} duplicated=${rosterDupes.length} ` +
          (rosterDupes.length ? JSON.stringify(rosterDupes.map(([n, c]) => `${n} x${c}`)) : ""));

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
          const sliceInstruction = buildSliceInstruction({
            userPrompt,
            sharedPlanJson,
            rosterJson,
            dayNumbers,
            takenList,
            findings: findingsForDays(planFindings, dayNumbers),
          });

          const result = await callAnthropicJson({
            apiKey: ANTHROPIC_API_KEY,
            system: systemBlocks,
            userContent: [...researchBlocks, { type: "text", text: sliceInstruction }],
            toolName: DAYS_TOOL.name,
            // A day runs ~1,200 output tokens, so this leaves generous headroom
            // per day in the slice. A cap that a 3-day slice can reach would
            // truncate the last day of the group.
            maxTokens: 2000 * dayNumbers.length + 1500,
            label,
          });
          costs.addAnthropic(`day_slice_${label}`, MODEL, result.usage);
          const parsed = result.data as { days?: unknown[] };
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

        // Locked days keep their roster identity — title, location, transit —
        // so the preview can tease them, but their periods were never
        // generated and there is nothing here to leak.
        for (const dayNumber of lockedDayNumbers) {
          const entry = roster[dayNumber - 1];
          const day = {
            dayNumber,
            title: entry?.title ?? `Day ${dayNumber}`,
            location: entry?.location ?? "",
            ...(entry?.transitNote ? { transitNote: entry.transitNote } : {}),
            periods: [],
            locked: true,
          };
          assembledDays.push(day);
          await emit(`${assembledDays.length > 1 ? "," : ""}${JSON.stringify(day)}`);
        }

        // Everything the skeleton produced, written after the days so the
        // failure note below can go into summary.assumptions directly.
        // fullTail is the unredacted version, persisted privately for resume;
        // tail is what actually ships.
        const fullTail: Record<string, unknown> = {};
        for (const key of ["summary", "budget", "flights", "accommodation", "bookingChecklist", "alternatives"]) {
          if (skeleton[key] !== undefined) fullTail[key] = skeleton[key];
        }
        if (researchSources.length) fullTail.sources = researchSources;

        // Name the gap where the traveler will actually read it, rather than
        // shipping a blank day with no explanation.
        if (failedDays.length > 0) {
          const summary = (fullTail.summary ?? {}) as Record<string, unknown>;
          const existing = Array.isArray(summary.assumptions) ? summary.assumptions : [];
          const plural = failedDays.length > 1;
          fullTail.summary = {
            ...summary,
            assumptions: [
              ...existing,
              `Day${plural ? "s" : ""} ${failedDays.join(", ")} could not be generated — regenerate the itinerary to fill ${plural ? "them" : "it"} in.`,
            ],
          };
        }

        const tail: Record<string, unknown> = { ...fullTail };
        if (tier !== "full") {
          const { visible, lockedCounts } = redactChecklist(fullTail.bookingChecklist, tier);
          if (fullTail.bookingChecklist !== undefined) tail.bookingChecklist = visible;
          tail.access = {
            tier,
            lockedDayCount: lockedDayNumbers.length,
            lockedBookingCounts: lockedCounts,
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
        // lodgingNames was computed before the roster was de-duplicated.
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

        finalizeCosts({ mode: tier === "full" ? "split" : `split_${tier}`, dayCount, theme: themeVariant?.id, grounded: hasGroundedResearch, batchId, jobId });

        // Persist the finished itinerary for reconnecting clients.
        await persistComplete();

        // Preview runs bank everything a resume-on-unlock needs: the
        // unredacted content so far, and the exact inputs the day-slice calls
        // were made with — the slices consume the research verbatim, so
        // without it an unlock would have to pay for research twice.
        if (tier !== "full" && jobId) {
          const writtenDays = assembledDays.filter(d => !(d as { locked?: boolean }).locked);
          const { error: privError } = await supabaseAdmin.from("itinerary_jobs_private").upsert({
            job_id: jobId,
            content: JSON.stringify({ days: writtenDays, ...fullTail }),
            resume_state: {
              batchId: batchId ?? jobId,
              themeVariant: themeVariant ?? null,
              roster,
              lockedDayNumbers,
              takenList,
              planFindings,
              sharedPlanJson,
              userPrompt,
              systemBlocks,
              researchBlocks,
            },
            updated_at: new Date().toISOString(),
          });
          if (privError) console.error("Failed to persist private job state:", privError);
        }
      } catch (streamError) {
        console.error("Generation/persist error:", streamError);
        // The money is spent whether or not the generation survived — a failed
        // run's cost matters as much as a successful one's.
        finalizeCosts({ mode: "error", theme: themeVariant?.id, batchId, jobId });
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

