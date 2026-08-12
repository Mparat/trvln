// Shared grounded-research pipeline.
//
// A single "generate" click fans out one itinerary per theme, and every one of
// those invocations used to resolve the destination and re-run the same five
// searches. Only the activities query varies by theme, so the rest was the same
// answer fetched N times — and, because each variant resolved its destination
// independently, three "variants of one trip" could quietly end up planning
// three different trips.
//
// research-trip runs the shared work once per batch and stores it; each
// generate-itinerary invocation loads that payload and adds only its own
// theme-specific activities query.

export interface ResearchResult {
  content: string;
  citations: string[];
}

export interface BudgetInfo {
  label: string;
  accommodation: string;
  daily: string;
}

export const getBudgetLabel = (value: number): BudgetInfo => {
  if (value <= 25) return { label: "Budget", accommodation: "$0-$50/night", daily: "$50-80/day" };
  if (value <= 50) return { label: "Moderate", accommodation: "$50-$100/night", daily: "$100-150/day" };
  if (value <= 75) return { label: "Comfortable", accommodation: "$100-$200/night", daily: "$200-300/day" };
  return { label: "Luxury", accommodation: "$200+/night", daily: "$400+/day" };
};

export const getFlightBudget = (value: number): string => {
  if (value <= 25) return "$100-$300";
  if (value <= 50) return "$300-$600";
  if (value <= 75) return "$600-$1000";
  return "$1000+";
};

// Perplexity grounded web search.
export async function searchWithPerplexity(
  query: string,
  apiKey: string,
): Promise<ResearchResult> {
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

// ============================================
// PREFERENCE CONTEXT
// Shared so the destination resolver and the itinerary prompt describe the
// same trip — research-trip needs these before generate-itinerary runs.
// ============================================

export interface TimingPreferences {
  dateFlexibility: string;
  startDate?: string;
  endDate?: string;
  flexibleDays?: number;
  targetMonth: string;
  durationFlexibility: string;
  durationDays: number;
}

const computeInclusiveDays = (startISO?: string, endISO?: string) => {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays + 1; // inclusive
};

export function buildDurationContext(p: TimingPreferences): string {
  // If user chose exact dates, calculate base duration and apply flexibility
  if (p.dateFlexibility === "strict") {
    const daysFromDates = computeInclusiveDays(p.startDate, p.endDate);
    if (daysFromDates) {
      if (p.flexibleDays && p.flexibleDays > 0) {
        // User has exact dates but with ± N days flexibility
        const minDays = Math.max(1, daysFromDates - p.flexibleDays);
        const maxDays = daysFromDates + p.flexibleDays;
        return `${minDays}-${maxDays} days (base: ${daysFromDates} days, ±${p.flexibleDays} days flexible)`;
      }
      return `exactly ${daysFromDates} days`;
    }
    return "dates provided but duration unclear";
  }

  switch (p.durationFlexibility) {
    case "weekend": return "2-3 day weekend trip";
    case "long-weekend": return "4-5 day long weekend";
    case "1-week": return "7 day trip";
    case "2-weeks": return "14 day trip";
    case "strict": return `exactly ${p.durationDays} days`;
    case "flexible-days": return `approximately ${p.durationDays} days (±2 days flexible)`;
    default: return "flexible duration - suggest optimal length";
  }
}

export function buildDateContext(p: TimingPreferences): string {
  switch (p.dateFlexibility) {
    case "strict":
      if (p.startDate && p.endDate) {
        if (p.flexibleDays && p.flexibleDays > 0) {
          // Exact dates with flexibility - AI can extend trip by ± N days on either end
          return `Target dates: ${p.startDate} to ${p.endDate} (±${p.flexibleDays} days flexible on either end). You may start up to ${p.flexibleDays} days earlier or end up to ${p.flexibleDays} days later if it improves the trip. Choose what works best for the destination and activities.`;
        }
        return `Fixed dates: ${p.startDate} to ${p.endDate}`;
      }
      return "Specific dates (not provided)";
    case "flexible-days":
      return p.startDate ? `Around ${p.startDate} (±few days flexible)` : "Flexible around specific dates";
    case "month":
      return p.targetMonth ? `Target: ${p.targetMonth}` : "Specific month/season";
    default:
      return "Anytime - recommend best time to visit";
  }
}

// ============================================
// DESTINATION RESOLUTION
// ============================================

export interface DestinationResolutionInput {
  cities: string[];
  additionalNotes: string;
  atmosphere: string[];
  interests: string[];
  adventureLevel: string;
  foodDrink: string[];
  budgetInfo: BudgetInfo;
  flightBudget: string;
  noFlight: boolean;
  departureCity: string;
  dateContext: string;
  durationContext: string;
}

export interface ResolvedDestination {
  cities: string[];
  wasResolved: boolean;
}

// When no explicit city is given, ask Claude Haiku to pick the best match
// before Perplexity runs, so all research is destination-specific.
export async function resolveDestinations(
  input: DestinationResolutionInput,
  anthropicApiKey: string,
): Promise<ResolvedDestination> {
  const cities = [...(input.cities ?? [])];
  if (cities.length > 0) return { cities, wasResolved: false };

  console.log("No explicit cities — resolving destination from preferences...");
  try {
    const resolutionPrompt = `You are a travel destination expert. Based on the traveler's preferences below, choose 1-2 destinations that best fit. Be decisive and concrete — a place a traveler can actually plan around, never a continent or a vague area like "Southeast Asia".

Pick the unit that matches how the trip actually moves:
- A trip based in one place is a city: "Chiang Mai, Thailand".
- A trip that moves through an area — a road trip, a thru-hike, a hut-to-hut trek, island hopping, a wine route — is the region plus the anchor towns that bound it: "Dolomites, Italy (Cortina d'Ampezzo to Ortisei)". Naming only the gateway city would send the research to the wrong place, because the trip happens between the towns, not in one of them.

Preferences:
- What they described: ${input.additionalNotes || "Not specified"}
- Atmosphere: ${input.atmosphere?.join(", ") || "no preference"}
- Interests: ${input.interests?.join(", ") || "no preference"}
- Adventure level: ${input.adventureLevel || "active"}
- Food preferences: ${input.foodDrink?.join(", ") || "no preference"}
- Accommodation budget: ${input.budgetInfo.label} (${input.budgetInfo.accommodation})
- Flight budget: ${input.noFlight ? "no flight needed (local/ground trip)" : input.flightBudget + " round trip"}
- Departing from: ${input.departureCity || "unknown"}
- Travel timing: ${input.dateContext}
- Duration: ${input.durationContext}

Respond with ONLY a JSON array of 1-2 destination strings. Examples:
["Lisbon, Portugal"]
["Chiang Mai, Thailand", "Bangkok, Thailand"]
["Dolomites, Italy (Cortina d'Ampezzo to Ortisei)"]
["Kii Peninsula, Japan (Kumano Kodo, Tanabe to Nachi)"]

No explanation. Just the JSON array.`;

    const resolutionResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: resolutionPrompt }],
        // Region answers carry their anchor towns, so they run longer than a bare city name.
        max_tokens: 200,
      }),
    });

    if (resolutionResponse.ok) {
      const resolutionData = await resolutionResponse.json();
      const resolutionText = resolutionData.content?.[0]?.text?.trim() ?? "";
      // Strip any accidental code fences
      const cleaned = resolutionText.replace(/```[a-z]*\n?/gi, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const resolved = parsed.filter((d: unknown) => typeof d === "string") as string[];
        if (resolved.length > 0) {
          console.log("Resolved destinations:", resolved);
          return { cities: resolved, wasResolved: true };
        }
      }
    }
  } catch (err) {
    console.error("Destination resolution failed — proceeding without explicit cities:", err);
  }

  return { cities, wasResolved: false };
}

// ============================================
// SEARCH QUERIES
// ============================================

export interface QueryContext {
  resolvedCities: string[];
  interests: string[];
  foodDrink: string[];
  additionalNotes: string;
  budgetInfo: BudgetInfo;
  durationDays: number;
  startDate?: string;
  endDate?: string;
  targetMonth: string;
  noFlight: boolean;
  departureCity: string;
}

interface DerivedQueryContext {
  destinationStr: string;
  primaryCity: string;
  interestsStr: string;
  foodStr: string;
  tripNotes: string;
  notesClause: string;
  tripDaysNum: number;
  isSingleCity: boolean;
  isLongTrip: boolean;
  currentYear: number;
}

const derive = (ctx: QueryContext): DerivedQueryContext => {
  // The traveler's own words are usually the most specific thing in the
  // request ("hut to hut", "no driving", "travelling with a toddler"). They
  // used to reach only the final prompt, so the research never saw the trip
  // the user actually described.
  const tripNotes = (ctx.additionalNotes ?? '').trim().slice(0, 500);
  return {
    destinationStr: ctx.resolvedCities.length > 0 ? ctx.resolvedCities.join(', ') : 'popular travel destinations',
    primaryCity: ctx.resolvedCities[0] || 'the destination',
    interestsStr: ctx.interests?.length > 0 ? ctx.interests.join(', ') : 'general sightseeing',
    foodStr: ctx.foodDrink?.length > 0 ? ctx.foodDrink.join(', ') : 'local cuisine',
    tripNotes,
    notesClause: tripNotes
      ? ` The traveler describes the trip as: "${tripNotes}". Prioritise recommendations that fit that description.`
      : '',
    tripDaysNum: ctx.durationDays || 7,
    isSingleCity: ctx.resolvedCities.length === 1,
    isLongTrip: (ctx.durationDays || 7) >= 7,
    currentYear: new Date().getFullYear(),
  };
};

export interface QuerySpec {
  key: string;
  query: string;
}

// Everything that does not depend on the theme. Runs once per batch.
export function buildSharedQuerySpecs(ctx: QueryContext): QuerySpec[] {
  const d = derive(ctx);
  const { budgetInfo } = ctx;

  const specs: QuerySpec[] = [
    // Restaurants and food scene — emphasise currently operating
    {
      key: 'restaurants',
      query: `Best ${d.foodStr} restaurants currently open in ${d.destinationStr} as of ${d.currentYear}. Only include establishments confirmed to be actively operating with recent positive reviews. Include specific restaurant names, neighborhoods, price ranges, and what they are known for. Exclude any restaurants that have closed, are temporarily closed, or have uncertain operating status. ${budgetInfo.label} budget.${d.tripNotes ? ` The traveler describes the trip as: "${d.tripNotes}" — if this trip spends nights somewhere without restaurants nearby (a mountain hut, a lodge, a remote village, a boat), say so and name where meals are actually eaten there instead.` : ''}`,
    },

    // Where to sleep, in whatever form this trip actually needs
    {
      key: 'accommodation',
      query: `Best ${budgetInfo.label} places to stay in ${d.destinationStr} priced ${budgetInfo.accommodation}. ${ctx.startDate && ctx.endDate ? `For dates: check-in ${ctx.startDate}, check-out ${ctx.endDate}.` : ctx.targetMonth ? `For travel in ${ctx.targetMonth}.` : ''} Include specific names with nightly rates and where each one is.${d.tripNotes ? ` The traveler describes the trip as: "${d.tripNotes}" — include the kinds of lodging this trip actually requires (for example mountain huts or refuges, guesthouses, campsites, lodges, hostels, ryokan), not only conventional hotels, and note how each is booked and what a night includes such as half board.` : ''}`,
    },

    // Nearby destinations + transportation (combined)
    {
      key: 'nearbyAndTransport',
      query: d.isSingleCity && d.isLongTrip
        ? `For a ${d.tripDaysNum}-day trip based in ${d.primaryCity}: what other cities should I visit, how to travel between them (trains, buses, flights with prices and times), and how many days to spend in each? Include day trips and overnight options.${d.notesClause}`
        : `Best day trips and nearby destinations from ${d.destinationStr} for a ${d.tripDaysNum}-day trip. Include travel time, transport options with prices, and why each is worth visiting.${d.notesClause}`,
    },

    // Seasonal & practical information
    {
      key: 'seasonal',
      query: `${d.destinationStr} travel in ${ctx.targetMonth || 'the travel season'}. Include weather, peak vs off-season pricing, festivals or events, crowd levels, and any seasonal closures.${d.notesClause}`,
    },

    // Planning, booking windows, access rules, conditions and required skill.
    // These are the details that decide whether a trip is possible at all,
    // and none of the queries above ask about them.
    {
      key: 'planning',
      query: `Practical planning for a ${d.tripDaysNum}-day trip in ${d.destinationStr}${ctx.targetMonth ? ` in ${ctx.targetMonth}` : ''}${d.tripNotes ? `, described by the traveler as: "${d.tripNotes}"` : ''}. Answer each of these specifically for ${d.currentYear}: (1) How far in advance do the places to stay need to be booked, and how is each one booked — online, by email, deposit required, cash only? (2) What permits, reservations, entry fees, timed-entry slots, or vehicle and access restrictions apply, and how are they obtained? (3) What conditions, closures, or seasonal limits affect this trip, and what is the usable window? (4) What fitness or skill level, equipment, and guiding does it require, and where locally can equipment be rented or a guide hired, at what price?`,
    },
  ];

  // Flight estimates (conditional)
  if (!ctx.noFlight && ctx.departureCity) {
    specs.push({
      key: 'flights',
      query: `Flights from ${ctx.departureCity} to ${d.primaryCity} in ${ctx.targetMonth || 'upcoming months'}. Include typical price ranges, best airlines, flight duration, and whether nonstop options exist.`,
    });
  }

  return specs;
}

// The one query that varies per itinerary variant, so it cannot be shared.
export function buildThemeQuerySpec(ctx: QueryContext, themeName: string): QuerySpec {
  const d = derive(ctx);
  return {
    key: 'activities',
    query: `Best things to do in ${d.destinationStr} for ${d.interestsStr} travelers. Include specific activity names, tour recommendations, must-visit attractions, hidden gems, and neighborhoods to explore.${themeName ? ` Focus on ${themeName} experiences.` : ''} ${ctx.budgetInfo.label} budget level.${d.notesClause}`,
  };
}

export type ResearchBundle = Record<string, ResearchResult | undefined>;

export async function runQuerySpecs(
  specs: QuerySpec[],
  apiKey: string,
): Promise<ResearchBundle> {
  console.log(`Executing ${specs.length} Perplexity research queries...`);
  const results = await Promise.all(specs.map(spec => searchWithPerplexity(spec.query, apiKey)));

  const bundle: ResearchBundle = {};
  specs.forEach((spec, i) => { bundle[spec.key] = results[i]; });
  return bundle;
}

// ============================================
// GROUNDED CONTEXT BLOCK
// ============================================

const citeList = (r: ResearchResult | undefined) =>
  r?.citations?.length ? r.citations.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'No citations available';

export function formatResearchContext(
  research: ResearchBundle,
  budgetInfo: BudgetInfo,
): string {
  return `
## GROUNDED RESEARCH DATA (From Live Web Search)

**CRITICAL INSTRUCTIONS:** The following is retrieved from live web search — treat it as FACTUAL GROUNDING.
- ONLY recommend places, activities, and restaurants that appear in this research
- Do NOT hallucinate establishment names or URLs
- For anything not in the research, use the fallback URL patterns in the system prompt

---

### 🗺️ NEARBY DESTINATIONS, DAY TRIPS & TRANSPORTATION
${research.nearbyAndTransport?.content || 'No nearby destinations/transport research available.'}

**Citations:**
${citeList(research.nearbyAndTransport)}

---

### 📅 SEASONAL & PRACTICAL INFORMATION
${research.seasonal?.content || 'No seasonal research available.'}

**Citations:**
${citeList(research.seasonal)}

---

### 🧭 PLANNING, BOOKING, ACCESS & CONDITIONS
${research.planning?.content || 'No planning research available.'}

**Use this section for:** bookingChecklist lead times and costs, summary.assumptions, transitNote content, and any permit, reservation, access restriction, seasonal window, or required gear/guiding the traveler must arrange. If this research says something must be booked months ahead, requires a permit, or needs equipment or a guide, that belongs in the itinerary — do not leave it out because it is not an attraction.

**Citations:**
${citeList(research.planning)}

---

### ✈️ FLIGHT INFORMATION
${research.flights?.content || 'No flight research available - use Google Flights for accurate pricing.'}

**Citations:**
${citeList(research.flights)}

---

### 🎯 ACTIVITIES & THINGS TO DO
${research.activities?.content || 'No activity research available.'}

**Citations:**
${citeList(research.activities)}

---

### 🍽️ RESTAURANTS & FOOD
${research.restaurants?.content || 'No restaurant research available.'}

**Citations:**
${citeList(research.restaurants)}

---

### 🏨 ACCOMMODATION
${research.accommodation?.content || 'No accommodation research available.'}

**User's Accommodation Budget:** ${budgetInfo.accommodation}
**If prices exceed this range, note why and provide a budget alternative.**

**Citations:**
${citeList(research.accommodation)}
`;
}
