import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

    // Build inspiration context
    let inspirationContext = "";
    if (cities?.length > 0) {
      inspirationContext = cities.join(", ");
    }
    if (media?.length > 0) {
      inspirationContext += inspirationContext ? ` (plus ${media.length} inspiration image(s))` : `${media.length} inspiration image(s)`;
    }
    
    console.log("Cities from preferences:", cities);
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
**INSPIRATION (must-visit destinations)**: ${inspirationContext || "No specific destinations - suggest based on preferences"}
**Note: The destinations listed above MUST be included in the itinerary. You may also suggest additional nearby destinations if appropriate for the trip duration and interests.**

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
      
      const destinationStr = cities?.length > 0 ? cities.join(', ') : 'popular travel destinations';
      const primaryCity = cities?.[0] || 'the destination';
      const interestsStr = interests?.length > 0 ? interests.join(', ') : 'general sightseeing';
      const foodStr = foodDrink?.length > 0 ? foodDrink.join(', ') : 'local cuisine';
      const themeStr = themeVariant?.name || '';
      
      // Determine trip length for context-aware queries
      const tripDaysNum = durationDays || 7;
      const isSingleCity = cities?.length === 1;
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

## Research and Citation Requirements

Conduct thorough research for each destination and activity. Search for information from these sources:

1. Travel blogs and vlogs - Recent, detailed experiences from travelers
2. Official tourism websites - Opening hours, prices, seasonal information
3. Travel guides (Lonely Planet, Rick Steves, etc.) - Expert recommendations
4. Activity booking platforms (Viator, GetYourGuide, Airbnb Experiences) - Specific tours and activities with pricing
5. Google Maps - Locations, distances, travel times between points
6. Google Flights - Flight information, prices, booking links
7. Transportation websites - Bus, train, or ferry schedules from official sources
8. Local forums and Reddit - Insider tips and recent traveler experiences
9. Restaurant review sites - Highly-rated dining options matching the user's vibe

**IMPORTANT: You must cite your source for every single recommendation you make.**

**Citation Format:**

Use these formats for citations:
- \`[Source: Blog Name - "Article Title" - URL]\` for blogs/articles
- \`[Source: Platform Name - URL]\` for booking platforms
- \`[Source: Official Website - URL]\` for official sources
- \`[Source: Google Flights - Date searched]\` for flight information
- \`[Source: Google Maps]\` for distances/times

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

## Planning Your Itinerary

Before writing your final itinerary, work through your planning systematically in <itinerary_planning> tags. Keep this section focused and efficient.

Address these steps in order:

**Step 1: Extract Hard Constraints**

List all non-negotiable constraints from the user inputs:
- Total budget (and calculate daily budget if possible)
- Trip duration (minimum and maximum days)
- Must-visit destinations
- Specific dates or date constraints
- Any dealbreakers mentioned in open text

**Step 2: Research Additional Destinations**

Given the number of destinations the user mentioned and the trip duration, research and list 3-5 potential additional nearby destinations that an expert would recommend. For each, write down:
- Name of destination
- Key research findings (quote highlights from your research about why it's recommended)
- Why it's worth including based on the user's interests ranking
- How many days it would need
- Rough daily cost estimate with source

Then decide which (if any) to include in the itinerary and explain why.

**Step 3: Optimal Routing**

Map out the geographic order to visit all locations (user-specified plus any additions). For each potential routing:
- List the order of destinations
- Note the distance/time between each stop (with citations)
- Calculate total transportation time and cost
- Identify any backtracking

Then select the most efficient route and explain why.

**Step 4: Time Allocation**

For each destination in your chosen route, calculate:
- Number of major activities/sights to cover (list them out)
- Days needed based on user's interests ranking
- Travel time to arrive and depart
- Recommended number of days with justification

Note: A well-paced itinerary includes breathing room. Not every time block needs a specific attraction - sometimes the best travel experiences come from wandering a neighborhood, sitting in a local cafe, or stumbling upon something unexpected. For trips of 5+ days, include at least 1-2 "exploration" blocks rather than back-to-back structured activities.

**Step 5: Budget Breakdown Math**

Calculate explicitly whether everything fits within budget. Show ALL your arithmetic step-by-step with explicit numbers:

- First, calculate total available budget: Write out "Total trip days × daily budget = total available" then substitute the actual numbers: "X days × $Y/day = $Z total"
- For each destination, calculate the subtotal showing each component:
  - Write: "Location 1: (accommodation cost per night × nights) + (estimated activities) + (estimated food) + (transport to/from)"
  - Then substitute numbers: "Location 1: ($X × Y nights) + $A activities + $B food + $C transport = $D"
  - Do this calculation for every single location, writing out each one
- Calculate flights separately: "Flights: $X"
- Now sum everything: Write out the addition: "$D1 + $D2 + $D3 + ... + $Flights" then calculate: "= $Total"
- Compare to budget: "$Total vs $Budget_Available"
- Calculate the difference explicitly: "Difference: $Total - $Budget_Available = $X (over/under)"
- If over budget, identify specific line items to cut, recalculate each affected location's subtotal, and show the new total

**Step 5b: Accommodation Price Verification**

For each hotel you recommend, verify pricing against the user's budget:
- User's accommodation budget target: ${budgetInfo.accommodation}
- Calculate: "User budget: ${budgetInfo.accommodation} × [number of nights] nights = $X total for accommodation"
- For each recommended hotel: "[Hotel name]: $Y/night × [nights] = $Z total"
- Compare: If $Z > $X, explicitly note this is over budget
- If prices exceed the user's accommodation budget due to seasonal factors or high demand:
  - Explain WHY prices are higher (peak season, event, high-demand area, etc.)
  - Provide at least one budget-friendly alternative hotel
  - Calculate the savings: "Alternative hotel: $A/night saves $B vs. primary recommendation"

**Step 6: Seasonal Considerations**

Research and note seasonal factors:
- Weather during travel dates (with citations)
- Peak/shoulder/off-season pricing implications
- Any closures or festivals (with citations)
- Crowd levels

**Step 7: Feasibility Check**

Based on all the above, can you visit all of the user's inspiration locations? If not, which must be cut and why?

**Step 8: Research Activities for Each Day**

For each day of your itinerary, research and list 3-5 potential activities. Activities can include:
- Specific attractions, museums, tours, or experiences
- **Neighborhood exploration** (e.g., "Walk around Shimokitazawa and browse vintage shops")
- **Unstructured discovery time** (e.g., "Explore the backstreets of Yanaka")

For each activity, note:
- What it is and key details
- Why it matches user's interests and vibe
- Time required and cost (exploration activities can be $0 or minimal)
- Source citation (for exploration, cite a travel blog recommending the neighborhood, or use [Neighborhood exploration - no booking required])

**Step 9: Activity Selection**

For each day, pick the best activities from your Step 8 research. Note any strong alternatives worth including in the alternatives section at the end.

**Step 10: Assumptions & Output Structure Planning**

List key assumptions (budget tier, season pricing, etc.), then confirm the final output order:
1. Executive summary
2. Key bookings and budget
3. Day-by-day itinerary
4. Alternatives

**Step 11: Output Structure Planning**

Review your planning and confirm the final structure: executive summary → key bookings/budget → day-by-day → alternatives.

## Output Structure

After your </itinerary_planning> closing tag, present your complete itinerary following this structure exactly:

### SECTION 1: EXECUTIVE SUMMARY

Include:
- Trip duration and dates (or recommended dates if flexible)
- Key highlights (top 3-5 experiences)
- Total estimated budget breakdown showing major categories
- Any important assumptions you made
- Brief description of what a route map should show

**Example structure:**
\`\`\`
## Executive Summary

**Trip Duration:** [X days, Date Range or "Flexible: recommended dates"]

**Key Highlights:**
- [Highlight 1]
- [Highlight 2]
- [Highlight 3]

**Total Estimated Budget:**
- Flights: $XX
- Accommodation: $XX
- Activities: $XX
- Food & Dining: $XX
- Transportation: $XX
- Contingency: $XX
- **Total: $XXX**

**Key Assumptions:**
- [Assumption 1]
- [Assumption 2]

**Route Overview:**
[Brief description of geographic routing]
\`\`\`

### SECTION 2: KEY BOOKINGS & BUDGET

#### Flight Information

Provide detailed flight options:

**Outbound Flight Options:**
For each option include:
- Airlines, departure/arrival times, total duration, number of stops
- Current price range
- Direct link to book on Google Flights
- Source citation

**Return Flight Options:**
Use the same format as outbound flights

**Alternative Flight Options:**
If relevant (different dates, airports, etc.), provide alternatives with same details

**Example structure:**
\`\`\`
**Outbound Flight Options:**

✈️ **Option 1:** [Airline] - [Departure City] to [Arrival City]
- Departure: [Date] at [Time]
- Arrival: [Date] at [Time]
- Duration: [X hours], [X stops/Nonstop]
- Price: $XXX-XXX
- Book: [Search on Google Flights](https://www.google.com/travel/flights?q=flights+from+DEPARTURE_CITY+to+DESTINATION${startDate ? `+departing+${formatDateForBooking(startDate)}` : ''}${endDate ? `+returning+${formatDateForBooking(endDate)}` : ''})
- [Source citation]
\`\`\`

#### Accommodation Recommendations

For each location:

**[Location Name]:**
- **Primary Recommendation:**
  - Name and type (hotel, hostel, Airbnb, etc.)
  - Price per night
  - Why it fits their vibe and budget
  - Direct booking link
  - Source citation
- **Alternative Options (1-2):**
  - Use same format as primary recommendation

**Example structure:**
\`\`\`
**[Location Name]:**

🏨 **Primary Recommendation:** [Name of Property]
- Type: [Hotel/Hostel/Airbnb/etc.]
- Price: $XX per night
- Why: [Explanation of fit with user's vibe and budget]
- Book: [URL]
- [Source citation]

🏨 **Alternative:** [Name of Property]
[Same format as primary]
\`\`\`

#### Booking Checklist & Timeline

Create an organized list with:
- Item to book
- When to book it (how far in advance)
- Direct link
- Estimated cost

Format as: \`[ ] Item to book - Book [timing] - [Link] - Est. $[cost]\`

**Example structure:**
\`\`\`
**Booking Checklist & Timeline:**

[ ] Flights - Book [X weeks/months in advance] - [URL] - Est. $XXX
[ ] [Location 1] Accommodation - Book [timing] - [URL] - Est. $XXX
[ ] [Major Activity] - Book [timing] - [URL] - Est. $XX
\`\`\`

#### Complete Budget Breakdown

Provide a detailed breakdown:
\`\`\`
**Complete Budget Breakdown:**

- Flights: $XX
- Accommodation: $XX (broken down by location if helpful)
  - [Location 1]: $XX
  - [Location 2]: $XX
- Activities: $XX
- Food & Dining: $XX
- Transportation (intercity): $XX
- Contingency/Miscellaneous: $XX
- **Total: $XXX**

[Compare to user's budget and note whether within range or explain tradeoffs]
\`\`\`

### SECTION 3: DAY-BY-DAY ITINERARY

For each day, use this structure:

**Day X: [Location] - [Theme/Focus]**

**Morning:**
- Activity/sight with time estimate
- Why you recommend this (tie to user interests)
- Practical details (address, opening hours, cost)
- Source citation

**Afternoon:**
- Use same format as morning

**Evening:**
- Use same format as morning

**Dining Options for Day X:**

**CRITICAL REQUIREMENT: You MUST provide 2-3 options for each meal type.**

- **Breakfast:**
  - [Option 1 Name] - [tags: casual/romantic/local/etc.] - Price range: $X-XX - [Source citation]
  - [Option 2 Name] - [tags] - Price range: $X-XX - [Source citation]
  - [Option 3 Name if applicable] - [tags] - Price range: $X-XX - [Source citation]

- **Lunch:**
  - Use same format (2-3 options)

- **Dinner:**
  - Use same format (2-3 options)

- **Bars/Nightlife** (if relevant to user's preferences):
  - [Option 1] - Vibe description - [Source citation]
  - [Option 2] - Vibe description - [Source citation]

**Transportation:**
- How to get between locations this day
- Estimated time and cost
- Booking information if needed
- Source citation

**Daily Budget Estimate:**
\`\`\`
- Accommodation: $XX
- Activities: $XX
- Food: $XX
- Transport: $XX
- Total: $XX
\`\`\`

**Activity Tags:** [Include relevant tags: nature, cultural, food & drink, adventure, educational, photo-worthy, romantic, family-friendly, wandering, local-vibe]

**Example structure for a day:**
\`\`\`
**Day 1: Tokyo - Arrival & Traditional Culture**

**Morning:**
🏯 Senso-ji Temple (9:00 AM - 11:00 AM)
Why: Perfect introduction to Tokyo's traditional side, aligns with your interest in cultural experiences
Details: 2-3-1 Asakusa, Taito City. Open 6 AM-5 PM. Free entry.
[Source citation]

**Afternoon:**
🚶 Explore Shimokitazawa (2:00 PM - 5:00 PM) [wandering] [local-vibe] [shopping]
Why: This bohemian neighborhood is perfect for unstructured exploration - vintage shops, indie cafes, and local street life
Details: No tickets needed. Wander the backstreets, pop into shops that catch your eye, grab coffee when you're tired
[Shimokitazawa area](https://www.google.com/maps/search/?api=1&query=Shimokitazawa+Tokyo)
[Source: Time Out Tokyo - "Shimokitazawa neighborhood guide"]

**Evening:**
[Similar format]

🍽️ **Dining Options for Day 1:**

**Breakfast:**
- [Restaurant 1] - [tags] - Price: $X-XX - [Source]
- [Restaurant 2] - [tags] - Price: $X-XX - [Source]

**Lunch:**
- [Restaurant 1] - [tags] - Price: $X-XX - [Source]
- [Restaurant 2] - [tags] - Price: $X-XX - [Source]
- [Restaurant 3] - [tags] - Price: $X-XX - [Source]

**Dinner:**
- [Restaurant 1] - [tags] - Price: $X-XX - [Source]
- [Restaurant 2] - [tags] - Price: $X-XX - [Source]

**Bars/Nightlife:**
- [Bar 1] - [Vibe description] - [Source]
- [Bar 2] - [Vibe description] - [Source]

🚌 **Transportation:**
Airport to hotel via [method]: [X minutes], $XX. [Booking info if needed]. [Source]

💰 **Daily Budget Estimate:**
- Accommodation: $XX
- Activities: $XX
- Food: $XX
- Transport: $XX
- Total: $XX

**Activity Tags:** [cultural] [photo-worthy] [educational]
\`\`\`

Continue this format for each day of the trip.

### SECTION 4: ALTERNATIVES & ADDITIONAL OPTIONS

#### Near-Miss Activities & Places

List activities/places that almost made it into the main itinerary (including those identified as near-ties in your comparative analysis). For each:
- What it is and where
- Why it's worth considering
- What it could replace in the main itinerary
- Time and cost estimates
- Source citation

**Example structure:**
\`\`\`
**Near-Miss Activities & Places:**

**[Activity Name] - [Location]**
What: [Description]
Why worth considering: [Explanation based on user interests]
Could replace: [Day X morning/afternoon/evening activity]
Time: [X hours], Cost: $XX
[Source citation]
\`\`\`

#### Constraint Explanations

If any constraints created conflicts, address them here:
- Clearly explain the tradeoff
- Present options if applicable (e.g., "To stay in budget, choose Option A with hostel accommodation OR Option B with fewer days")

#### Practical Information

Include with source citations:
- **Visa requirements:** [Details with citations]
- **Currency and typical costs:** [Local currency, exchange rate, tipping customs]
- **Local transportation tips:** [How to get around, costs, booking info with citations]
- **Weather expectations:** [What to expect during travel dates with citations]
- **Safety considerations:** [Any relevant safety information]
- **Packing suggestions:** [Based on planned activities and weather]
- **Useful phrases:** [If visiting non-English speaking destinations]
- **Emergency contacts:** [Relevant phone numbers, embassy info]

All practical information must include source citations.

## URL FORMATTING RULES (CRITICAL):

EVERY activity, tour, restaurant, cafe, bar, or experience MUST include a clickable URL. ONLY use these EXACT URL patterns:

**FOR RESTAURANTS/CAFES/BARS/DINING** - ALWAYS use SPECIFIC restaurant names with Google Maps:
- ❌ NEVER use generic searches like "restaurants near X" or "cafes in Y neighborhood"
- ✅ ALWAYS name the SPECIFIC restaurant/cafe/bar (e.g., "Narisawa", "Gonpachi Nishi-Azabu", "Bar High Five")
- Format: https://www.google.com/maps/search/?api=1&query=SPECIFIC+RESTAURANT+NAME+CITY
- Example: [Narisawa](https://www.google.com/maps/search/?api=1&query=Narisawa+Tokyo)
- Example: [Ichiran Shibuya](https://www.google.com/maps/search/?api=1&query=Ichiran+Shibuya+Tokyo)
- Example: [Bar High Five](https://www.google.com/maps/search/?api=1&query=Bar+High+Five+Ginza+Tokyo)

**FOR PLACES/ATTRACTIONS** - Use Google Maps search:
- Format: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY+COUNTRY
- Example: [Mercado Roma](https://www.google.com/maps/search/?api=1&query=Mercado+Roma+Mexico+City)

**FOR GUIDED TOURS** - Use GetYourGuide SEARCH:
- Format: https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY
- Example: [Teotihuacan Day Tour](https://www.getyourguide.com/s/?q=Teotihuacan+day+tour+Mexico+City)

**FOR FLIGHTS** - Use Google Flights with dates and route:
- Format: https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION+departing+YYYY-MM-DD+returning+YYYY-MM-DD
${departureCity ? `- User's departure city: ${departureCity} (use this as the flight origin)` : '- No departure city specified (use a reasonable origin based on context)'}
${startDate ? `- User's start date: ${formatDateForBooking(startDate)} (use as departing date)` : ''}
${endDate ? `- User's end date: ${formatDateForBooking(endDate)} (use as returning date)` : ''}
- Example: [Search Flights](https://www.google.com/travel/flights?q=flights+from+${departureCity ? departureCity.replace(/\s+/g, '+') : 'New+York'}+to+Tokyo${startDate ? `+departing+${formatDateForBooking(startDate)}` : ''}${endDate ? `+returning+${formatDateForBooking(endDate)}` : ''})
- If no specific dates: https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION

**FOR HOTELS/ACCOMMODATION** - Use Booking.com SEARCH:
- Format: https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY
- Example: [Hotel Nima](https://www.booking.com/searchresults.html?ss=Hotel+Nima+Mexico+City)

**FOR GENERAL INFO** - Use Google search:
- Format: https://www.google.com/search?q=SEARCH+TERMS

❌ NEVER use:
- Made-up domains (cultured-foodie.com, tokyo-eats.com)
- Deep links you're not 100% sure exist
- Short URLs (goo.gl, bit.ly, maps.app.goo.gl)
- Viator or TripAdvisor deep links (use search URLs instead)

## Formatting Requirements (CRITICAL - FOLLOW EXACTLY)

### Header Hierarchy (use these EXACT patterns):
- **## SECTION TITLE** - Main sections (EXECUTIVE SUMMARY, KEY BOOKINGS, etc.) - ALL CAPS
- **## Day X: Location - Theme** - Day headers, always "Day" + number + colon + location
- **### Sub-section Title** - Sub-sections within main sections (Flights, Accommodation, Budget Breakdown)
- **#### Time Period** - Time-of-day headers within days (Morning, Afternoon, Evening)

### Bullet Point Rules (MANDATORY):
- ALL content that is not a header MUST be a bullet point using "-" (hyphen)
- Top-level bullets: "- Content here" (no leading spaces)
- Nested bullets level 1: "  - Content here" (exactly 2 spaces before hyphen)
- Nested bullets level 2: "    - Content here" (exactly 4 spaces before hyphen)
- NEVER use "*" for bullets - ONLY use "-"
- NEVER write loose paragraph text - ALWAYS use bullets
- Every piece of information must be a bullet point

### Content Structure Examples:

**CORRECT - Day Structure:**
\`\`\`
## Day 1: Tokyo - Arrival & Traditional Culture

#### Morning
- 🏯 **Senso-ji Temple** (9:00 AM - 11:00 AM) [cultural] [photo-worthy]
  - Why: Perfect introduction to Tokyo's traditional side
  - Details: 2-3-1 Asakusa, Taito City. Open 6 AM-5 PM. Free entry
  - [Senso-ji Temple](https://www.google.com/maps/search/?api=1&query=Senso-ji+Temple+Tokyo)

#### Afternoon
- 🎨 **TeamLab Borderless** (1:00 PM - 4:00 PM) [cultural] [photo-worthy]
  - Why: Immersive digital art experience
  - Details: Book in advance. ~$30 entry
  - [TeamLab Borderless](https://www.google.com/maps/search/?api=1&query=TeamLab+Borderless+Tokyo)
\`\`\`

**CORRECT - Budget Breakdown:**
\`\`\`
### Complete Budget Breakdown
- **Flights:** $850 round trip
  - Outbound: Delta, $425
  - Return: United, $425
- **Accommodation:** $1,200 total
  - Tokyo (4 nights): $200/night = $800
  - Kyoto (2 nights): $200/night = $400
- **Activities:** $350
- **Food & Dining:** $500 (~$70/day)
- **Total: $2,900**
\`\`\`

**CORRECT - Restaurant Options:**
\`\`\`
#### Dinner Options
- **Narisawa** - [fine dining, innovative] - $$$$ - [Google Maps](URL)
  - Michelin 2-star, reservation required months in advance
- **Gonpachi Nishi-Azabu** - [izakaya, atmospheric] - $$$ - [Google Maps](URL)
  - Famous "Kill Bill" restaurant, great for groups
- **Ichiran Ramen** - [ramen, quick] - $$ - [Google Maps](URL)
  - Perfect for a quick, delicious meal
\`\`\`

**WRONG - Do NOT do these:**
\`\`\`
❌ Loose paragraph without bullet:
The temple is beautiful and worth visiting in the morning.

✅ CORRECT:
- The temple is beautiful and worth visiting in the morning

❌ Using asterisks for bullets:
* Visit the temple

✅ CORRECT:
- Visit the temple

❌ Inconsistent nesting (3 or 5 spaces):
- Main item
   - Nested with 3 spaces
     - Another with 5 spaces

✅ CORRECT (2 or 4 spaces only):
- Main item
  - Nested with 2 spaces
    - Another with 4 spaces
\`\`\`

### Emoji Usage:
- ✈️ for flights/travel
- 🏨 for accommodation
- 🍽️ for dining sections
- 🚌 for transportation
- 💰 for budget/costs
- 🏯🎨🌳🏖️ etc. for specific activities (at start of activity name only)

### Bold Text Rules:
- **Bold** important names: restaurant names, hotel names, activity names
- **Bold** prices and totals
- **Bold** time slots within activities
- Do NOT bold entire sentences or paragraphs

### Activity Tags:
- Include in brackets after activity name: [nature] [cultural] [adventure] [food & drink] [educational] [photo-worthy] [romantic] [family-friendly]

### CRITICAL REMINDER:
- Every single piece of content must be a bullet point with "-"
- The ONLY non-bulleted content should be headers (##, ###, ####)
- If you find yourself writing a paragraph, convert it to bullet points
- Sub-details should be nested bullets under their parent item

## Important Guidelines

Keep these guidelines in mind throughout your work:

- **Food and dining is the ONE area where you must ALWAYS provide multiple options** (2-3 per meal type for every day)
- Cite sources for every single recommendation - flights, hotels, activities, restaurants, transportation, practical information
- If the user left something open-ended (like exact duration), recommend the optimal choice based on their other inputs and explain why
- Always explain if you had to skip any inspiration locations
- Verify transportation schedules and costs from official sources when possible
- Ensure the itinerary flows logically and efficiently without unnecessary backtracking
- Stay within budget or clearly explain why that's not possible and what tradeoffs are available
- Match the user's desired vibe and atmosphere throughout all recommendations
- When the user mentions relatively few destinations for a long trip duration, research and suggest additional nearby destinations that a local expert or experienced travel planner would recommend
- Pay special attention to the user's interests ranking when choosing between competing options
- Ensure the adventure level matches user preferences (don't suggest extreme activities for low-adventure preferences)
- **Critical verification step:** After researching activities, conduct a second comparative search to cross-check each option against alternatives. Compare the top 2-3 options explicitly before committing to your final choice. Document near-tie alternatives for the alternatives section.

Begin by working through your systematic planning in <itinerary_planning> tags, then present your complete itinerary following the structure outlined above.`;

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
        max_tokens: 10000,
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
