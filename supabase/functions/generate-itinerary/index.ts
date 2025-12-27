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

    // Build user inputs block for the prompt
    const userInputsBlock = `
**INSPIRATION (must-visit destinations)**: ${inspirationContext || "No specific destinations - suggest based on preferences"}

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

    const systemPrompt = `You are an expert travel planner AI assistant. Your task is to create a comprehensive, well-researched travel itinerary based on user preferences, constraints, and desired destinations.

${themeContext ? themeContext + "\n\n" : ""}

# Your Task Overview

You will analyze the user's inputs, conduct thorough research, and produce a detailed day-by-day travel plan that maximizes their experience while respecting their budget, time, and preferences.

# Understanding User Inputs

The user inputs are organized into several categories:

**Inspiration**: These are the destinations the user wants to visit. Your itinerary must include all of these unless logistically impossible. If you must skip any, clearly explain why.

**Logistics**: 
- Budget constraints are firm - stay within them or explain what tradeoffs are necessary
- Date flexibility determines your options for flight pricing and seasonal considerations
- Duration preferences guide the scope of your itinerary
- Flight preferences affect total travel time and cost

**Vibe**:
- Atmosphere choices determine the types of destinations and activities within each location
- Adventure level affects activity selection
- Food & drink preferences guide restaurant recommendations
- Interests ranking helps you prioritize when choices must be made
- Self-serve appetite determines whether to suggest guided tours or independent exploration

**Open Text**: This may clarify, override, or add nuance to the structured inputs above. Pay close attention to any specific requests or concerns mentioned here.

# Planning Your Itinerary

Before writing your final itinerary, work through your planning inside <planning> tags. Address these systematically:

1. **Extract Hard Constraints**: List out all non-negotiable constraints from the user inputs:
   - Total budget (and daily budget if calculable)
   - Trip duration (min/max days)
   - Must-visit destinations
   - Specific dates or date constraints
   - Any dealbreakers mentioned in open text

2. **Research Additional Destinations**: Given the number of destinations the user mentioned and the trip duration, list 3-5 potential additional nearby destinations that an expert would recommend. For each:
   - Name of destination
   - Why it's worth including
   - How many days it would need
   - Rough daily cost estimate
   Then decide which (if any) to include in the itinerary and explain why.

3. **Optimal Routing**: Map out the geographic order to visit all locations. For each potential routing:
   - List the order of destinations
   - Note the distance/time between each
   - Calculate total transportation time and cost
   - Identify any backtracking
   Then select the most efficient route and explain why.

4. **Time Allocation**: For each destination in your chosen route, calculate:
   - Number of major activities/sights to cover
   - Days needed based on user's interests ranking
   - Travel time to get there and leave
   - Recommended number of days with justification

5. **Budget Breakdown Math**: Calculate explicitly whether everything fits:
   - Total trip days × daily budget = total available
   - For each destination: (accommodation cost per night × nights) + (estimated activities) + (estimated food) + (transport to/from)
   - Sum all destinations + flights
   - Compare to total available
   - If over budget, identify what to cut or adjust

6. **Seasonal Considerations**: Note seasonal factors:
   - Weather during travel dates
   - Peak/shoulder/off-season pricing
   - Any closures or festivals
   - Crowd levels

7. **Feasibility Check**: Based on all the above, can the user's inspiration locations all be visited? If not, which must be cut and why?

8. **Assumptions Summary**: List all key assumptions you're making (e.g., "assuming mid-range accommodation," "assuming shoulder season pricing," etc.)

Work through all of these considerations systematically in your planning section.

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

# Output Structure

After your <planning> section, present your complete itinerary with these sections:

## 1. EXECUTIVE SUMMARY
Include:
- Trip duration and dates (or recommended dates if flexible)
- Total estimated budget breakdown
- Key highlights (top 3-5 experiences)
- Any important assumptions made

## 2. FLIGHT INFORMATION
Provide:
- **Outbound flight options** with airlines, times, duration, stops, price range
- **Return flight options** with same details
- Direct link: [Search on Google Flights](https://www.google.com/flights)
- **Alternative flight options** if relevant

## 3. ACCOMMODATION RECOMMENDATIONS
For each location:
- **Primary recommendation** with name, type, price per night, why it fits their vibe/budget
- [Book on Booking.com](https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY)
- **1-2 alternative options** with same details

## 4. DAY-BY-DAY ITINERARY

For each day, use this format:

**Day X: [Location] — [Theme/Focus]**

**Morning:**
- Activity with time estimate
- Why this is recommended (ties to user interests)
- Practical details (address, opening hours, cost)
- [View on Google Maps](URL) or [Book here](URL)

**Afternoon:**
- Same format as morning

**Evening:**
- Same format as morning

**Dining Options for Day X:**
- **Breakfast**: 2-3 options with [tags: casual/romantic/local/etc.], price range, [View on Maps](URL)
- **Lunch**: 2-3 options with tags, price range, links
- **Dinner**: 2-3 options with tags, price range, links
- **Bars/nightlife** (if relevant): 2-3 options with vibe description, links

**Transportation:**
- How to get between locations this day
- Estimated time and cost
- Booking information if needed

**Daily Budget Estimate:**
- Accommodation: $XX
- Activities: $XX
- Food: $XX
- Transport: $XX
- Total: $XX

**Activity Tags:** [nature] [cultural] [food & drink] [adventure] [educational] [photo-worthy] [romantic] [family-friendly]

## 5. ALTERNATIVES & NEAR-MISSES
List 3 activities/places that almost made it into the itinerary:
- What it is
- Why it's worth considering
- What it could replace in the main itinerary

## 6. CONSTRAINT EXPLANATIONS
If any constraints created conflicts:
- Clearly explain the tradeoff
- Present options if applicable

## 7. PRACTICAL INFORMATION
Include:
- Visa requirements
- Currency and typical costs
- Local transportation tips
- Weather expectations for travel dates
- Any safety considerations
- Packing suggestions based on activities

## 8. BOOKING CHECKLIST
Create an organized list of everything to book with:
- [ ] What to book
- When to book it (how far in advance)
- Direct link
- Estimated cost

# Important Reminders

- If the user left something open-ended (like duration), recommend the optimal choice based on their other inputs and explain why
- Food and drink is the ONE area where you must ALWAYS provide multiple options (2-3 per meal)
- Always explain if you had to skip any inspiration locations
- Make sure the itinerary flows logically and efficiently
- Stay within budget or clearly explain why that's not possible
- Match the user's desired vibe and atmosphere throughout
- When the user mentions relatively few destinations for a long trip duration, suggest additional nearby destinations that an expert would recommend

Begin by working through your planning in <planning> tags, then present your complete itinerary.`;

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
