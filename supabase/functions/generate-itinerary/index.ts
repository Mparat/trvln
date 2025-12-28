import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preferences, themeVariant } = await req.json();

    console.log("Received preferences:", JSON.stringify(preferences, null, 2));
    console.log("Theme variant:", themeVariant || "default");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const {
      media,
      cities,
      budgetAccommodation,
      budgetFlight,
      dateFlexibility,
      startDate,
      endDate,
      targetMonth,
      durationFlexibility,
      durationDays,
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

    // If user chose exact dates, always respect the date range as the duration
    if (dateFlexibility === "strict") {
      const daysFromDates = computeInclusiveDays(startDate, endDate);
      durationContext = daysFromDates ? `exactly ${daysFromDates} days` : "dates provided but duration unclear";
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
        dateContext =
          startDate && endDate ? `Fixed dates: ${startDate} to ${endDate}` : "Specific dates (not provided)";
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
      'prefer-guided': 'Prefer guided tours and organized activities',
      'some-guided': 'Mix of guided activities and self-exploration',
      'self-serve': 'Self-serve only - no guided tours, DIY everything'
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

    // Build user inputs block for the prompt
    const userInputsBlock = `
**INSPIRATION (must-visit destinations)**: ${inspirationContext || "No specific destinations - suggest based on preferences"}
**CRITICAL: You MUST plan the itinerary for these exact destinations: ${cities?.length > 0 ? cities.join(", ") : "none specified - you may suggest destinations"}. Do NOT substitute with different cities.**

**LOGISTICS**:
- Budget (Accommodation): ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total daily)
- Budget (Flights): ${flightBudget} round trip
- Date flexibility: ${dateContext}
- Duration: ${durationContext}
- Flight preference: ${flightDirectness === "nonstop" ? "Nonstop preferred" : flightDirectness === "short-layover" ? "Short layovers OK" : "All options including long layovers"}
${departureCity ? `- Departing from: ${departureCity}` : ""}

**VIBE**:
- Atmosphere: ${atmosphere?.length > 0 ? atmosphere.join(", ") : "No preference"}
- Adventure level: ${adventureLevel || "No preference"}
- Guided vs self-serve: ${guidedLabel}
- Food & drink: ${foodDrink?.length > 0 ? foodDrink.join(", ") : "No preference"}
- Interests (ranked): ${interests?.length > 0 ? interests.join(" > ") : "No preference"}

**OPEN TEXT / ADDITIONAL NOTES**:
${additionalNotes || "None provided"}
`;

    const systemPrompt = `You are an expert travel planning AI assistant. Your task is to create comprehensive, well-researched travel itineraries based on user preferences, constraints, and desired destinations. You must cite sources for every recommendation you make.

${themeContext ? themeContext + "\n\n" : ""}

# Understanding the User Inputs

The user inputs are organized into four main categories:

**1. Inspiration** - The destinations the user wants to visit
- **CRITICAL: You MUST use ONLY the destinations specified by the user. Do NOT substitute with different cities or make up destinations.**
- Your itinerary must include all user-specified destinations unless logistically impossible
- If you must skip any destination, clearly explain why
- If no destinations are specified, THEN you may suggest destinations based on preferences

**2. Logistics** - Practical constraints
- Budget: These constraints are firm. Stay within them or explain what tradeoffs are necessary
- Date flexibility: This determines your options for flight pricing and seasonal considerations
- Duration preferences: This guides the scope of your itinerary
- Flight preferences: These affect total travel time and cost

**3. Vibe** - Preferences that shape the experience
- Atmosphere choices: These determine the types of destinations and activities within each location
- Adventure level: This affects activity selection
- Food & drink preferences: These guide restaurant recommendations
- Interests ranking: This helps you prioritize when making choices
- Self-serve appetite: This determines whether to suggest guided tours or independent exploration

**4. Open Text** - Additional context
- This may clarify, override, or add nuance to the structured inputs above
- Pay close attention to any specific requests or concerns mentioned here

# Research Requirements

Conduct thorough research for each destination and activity. Search for information from these sources:

1. Travel blogs and vlogs - Look for recent, detailed experiences from travelers
2. Official tourism websites - Verify opening hours, prices, and seasonal information
3. Travel guides (Lonely Planet, Rick Steves, etc.) - Get expert recommendations
4. Activity booking platforms (Viator, GetYourGuide, Airbnb Experiences) - Find specific tours and activities with pricing
5. Google Maps - Verify locations, distances, and travel times between points
6. Google Flights - Get accurate flight information, prices, and booking links
7. Transportation websites - Verify bus, train, or ferry schedules from official sources
8. Local forums and Reddit - Find insider tips and recent traveler experiences
9. Restaurant review sites - Identify highly-rated dining options that match the user's vibe

**Citation Format**

For every recommendation, cite your source using these formats:
- \`[Source: Blog Name - "Article Title" - URL]\` for blogs/articles
- \`[Source: Platform Name - URL]\` for booking platforms
- \`[Source: Official Website - URL]\` for official sources
- \`[Source: Google Flights - Date searched]\` for flight info
- \`[Source: Google Maps]\` for distances/times

# Planning Your Itinerary (LLM THINKING - Use <itinerary_planning> tags)

Before writing your final itinerary, work through your planning systematically in <itinerary_planning> tags. It's OK for this section to be quite long. Address these steps in order:

**Step 0: Extract and Quote Key User Preferences**
Quote verbatim the most important preferences from the user inputs:
- Write out their exact inspiration destinations
- Write out their exact budget and duration constraints
- Write out their exact vibe preferences (atmosphere, adventure level, interests ranking)
- Write out any critical statements from the open text section
- Note which preferences might conflict with each other

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

**Step 5: Budget Breakdown Math**
Calculate explicitly whether everything fits within budget. Show your arithmetic:
- Total trip days × daily budget = total available (write out: X days × $Y/day = $Z total)
- For each destination, calculate: (accommodation cost per night × nights) + (estimated activities) + (estimated food) + (transport to/from)
  - Write this out for each location: Location 1: ($X × Y nights) + $A activities + $B food + $C transport = $D
  - Location 2: ($X × Y nights) + $A activities + $B food + $C transport = $D
  - Continue for all locations
- Flights: $X
- Sum all amounts: $D1 + $D2 + ... + $Flights = $Total
- Compare to budget: $Total vs $Budget_Available
- Calculate difference: Over/under by $X
- If over budget, identify specific items to cut or adjust and recalculate

**Step 6: Seasonal Considerations**
Research and note seasonal factors:
- Weather during travel dates (with citations)
- Peak/shoulder/off-season pricing implications
- Any closures or festivals (with citations)
- Crowd levels

**Step 7: Feasibility Check**
Based on all the above, can you visit all of the user's inspiration locations? If not, which must be cut and why?

**Step 8: Assumptions Summary**
List all key assumptions you're making (e.g., "assuming mid-range accommodation," "assuming shoulder season pricing," etc.)

**Step 9: Citation Verification**
Before moving to the output, verify you have sources ready for:
- All flight information
- All accommodation recommendations
- All activities and attractions
- All restaurant recommendations
- All transportation between cities
- All practical information (visa, weather, etc.)

Note any gaps where you'll need to indicate that up-to-date research is needed.

**Step 10: Output Structure Planning**
Review your planning and determine the final structure for your itinerary. Remember that the output must follow this specific ordering:
1. Executive summary first
2. Key things to book and budget information second
3. Day-by-day itinerary third
4. Alternative options and extras at the end

# URL FORMATTING RULES (CRITICAL):

EVERY activity, tour, restaurant, or experience MUST include a clickable URL. ONLY use these EXACT URL patterns:

**FOR PLACES/RESTAURANTS/ATTRACTIONS** - Use Google Maps search:
- Format: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY+COUNTRY
- Example: [Mercado Roma](https://www.google.com/maps/search/?api=1&query=Mercado+Roma+Mexico+City)

**FOR GUIDED TOURS** - Use GetYourGuide SEARCH:
- Format: https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY
- Example: [Teotihuacan Day Tour](https://www.getyourguide.com/s/?q=Teotihuacan+day+tour+Mexico+City)

**FOR FLIGHTS**:
- Use: https://www.google.com/flights

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

# FORMATTING RULES:

1. NEVER use asterisks (*) for bullet points - use hyphens (-) only
2. NEVER duplicate information
3. Use proper indentation for nested bullets:
   - Top-level items start with "- "
   - Sub-items start with "  - " (2 spaces before dash)
4. For bold text, use exactly two asterisks: **text**
5. Use emojis sparingly to enhance readability (🏨 for accommodation, ✈️ for flights, 🍽️ for dining, etc.)

# Output Structure (ACTUAL OUTPUT - After </itinerary_planning>)

After your </itinerary_planning> closing tag, present your complete itinerary following this structure exactly:

## SECTION 1: EXECUTIVE SUMMARY

Include:
- Trip duration and dates (or recommended dates if flexible)
- Key highlights (top 3-5 experiences)
- Total estimated budget breakdown showing major categories
- Any important assumptions you made
- Brief description of what a route map should show

## SECTION 2: KEY BOOKINGS & BUDGET

### Flight Information

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

### Accommodation Recommendations

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

### Booking Checklist & Timeline

Create an organized list with:
- Item to book
- When to book it (how far in advance)
- Direct link
- Estimated cost

Format as: \`[ ] Item to book - Book [timing] - [Link] - Est. $[cost]\`

### Complete Budget Breakdown

Provide a detailed breakdown:
- Flights: $XX
- Accommodation: $XX (broken down by location if helpful)
- Activities: $XX
- Food & Dining: $XX
- Transportation (intercity): $XX
- Contingency/Miscellaneous: $XX
- **Total: $XX**

Compare this to the user's budget and note whether it's within range or explain necessary tradeoffs.

## SECTION 3: DAY-BY-DAY ITINERARY

For each day, use this structure:

**Day X: [Location] — [Theme/Focus]**

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

You must provide 2-3 options for each meal type:

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

**Activity Tags:** [Include relevant tags: nature, cultural, food & drink, adventure, educational, photo-worthy, romantic, family-friendly]

*Continue this format for each day of the trip.*

## SECTION 4: ALTERNATIVES & ADDITIONAL OPTIONS

### Near-Miss Activities & Places

List activities/places that almost made it into the main itinerary. For each:
- What it is and where
- Why it's worth considering
- What it could replace in the main itinerary
- Time and cost estimates
- Source citation

### Constraint Explanations

If any constraints created conflicts, address them here:
- Clearly explain the tradeoff
- Present options if applicable (e.g., "To stay in budget, choose Option A with hostel accommodation OR Option B with fewer days")

### Practical Information

Include:
- **Visa requirements:** [Details with citations]
- **Currency and typical costs:** [Local currency, exchange rate, tipping customs]
- **Local transportation tips:** [How to get around, costs, booking info with citations]
- **Weather expectations:** [What to expect during travel dates with citations]
- **Safety considerations:** [Any relevant safety information]
- **Packing suggestions:** [Based on planned activities and weather]
- **Useful phrases:** [If visiting non-English speaking destinations]
- **Emergency contacts:** [Relevant phone numbers, embassy info]

All practical information must include source citations.

# Important Guidelines

Keep these guidelines in mind throughout your work:

- **Food and dining is the ONE area where you must ALWAYS provide multiple options** (2-3 per meal type)
- If the user left something open-ended (like exact duration), recommend the optimal choice based on their other inputs and explain why
- Always explain if you had to skip any inspiration locations
- Verify transportation schedules and costs from official sources when possible
- Make sure the itinerary flows logically and efficiently without unnecessary backtracking
- Stay within budget or clearly explain why that's not possible and what tradeoffs are available
- Match the user's desired vibe and atmosphere throughout all recommendations
- For every recommendation (activities, restaurants, hotels, etc.), include a proper source citation
- When the user mentions relatively few destinations for a long trip duration, research and suggest additional nearby destinations that a local expert or experienced travel planner would recommend
- Pay special attention to the user's interests ranking when choosing between competing options
- Ensure the adventure level matches user preferences (don't suggest extreme activities for low-adventure preferences)

Begin by working through your systematic planning in <itinerary_planning> tags, then present your complete itinerary following the structure outlined above.`;

    const userPrompt = `Here are my travel planning inputs:

<user_inputs>
${userInputsBlock}
</user_inputs>

Create a comprehensive, well-researched travel itinerary based on these preferences. Be opinionated and specific - tell me exactly what I should do.`;

    // Build messages
    const messages: any[] = [{ role: "system", content: systemPrompt }];

    // Handle media (images/videos)
    const hasMedia = media && media.length > 0;

    if (hasMedia) {
      const content: any[] = [{ type: "text", text: userPrompt }];

      for (const item of media) {
        if (item.preview) {
          content.push({
            type: "image_url",
            image_url: { url: item.preview },
          });
        }
      }

      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    console.log("Calling Lovable AI Gateway");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Failed to generate itinerary. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Error in generate-itinerary function:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
