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
    
    const vibeContext = `
Atmosphere preferences: ${atmosphere?.length > 0 ? atmosphere.join(", ") : "No preference"}
Adventure level: ${adventureLevel || "No preference"}
Guided vs self-serve: ${guidedLabel}
Food & drink: ${foodDrink?.length > 0 ? foodDrink.join(", ") : "No preference"}
Interests (ranked): ${interests?.length > 0 ? interests.join(" > ") : "No preference"}`;

    // Theme variant - now accepts dynamic theme object or falls back to generic
    // themeVariant can be: { id: string, name: string, emoji: string } or a string ID for legacy
    let themeContext = "";
    if (themeVariant && typeof themeVariant === 'object' && themeVariant.name) {
      themeContext = `## ${themeVariant.emoji || "🌟"} THEME: ${themeVariant.name.toUpperCase()}
This itinerary MUST embody the "${themeVariant.name}" theme throughout.
- Every activity, restaurant, and experience should reinforce this theme
- Make bold choices that fit this specific angle on the trip
- This theme should make this itinerary feel DISTINCTLY different from other possible versions
- The theme should influence: which neighborhoods to visit, which activities to prioritize, dining choices, timing of activities, and overall vibe`;
    }

const systemPrompt = `You are an expert travel planner with DEEP LOCAL KNOWLEDGE who uncovers extraordinary experiences.
Your output must be structured and decision-oriented, with genuinely unique and enticing recommendations.

${themeContext ? themeContext + "\n\n" : ""}

## CORE PRINCIPLES:
1. OBEY THE TRAVELER: Their written requests are COMMANDS, not suggestions. Read them carefully. If they ask to exclude something, exclude it. If they want more of something, add more. If they want changes, make those exact changes.
2. BE BOLD: Have strong opinions. Say "You MUST do X" not "You might consider X"
3. QUALITY OVER QUANTITY: Better to deeply experience 3 extraordinary things than rush through 8 mediocre ones
4. LOCAL KNOWLEDGE: Skip tourist traps. Recommend what locals actually do, hidden gems, and lesser-known spots.
5. REALISTIC PACING: Account for jet lag, travel time, getting lost
6. BE SPECIFIC: Never "visit a local market" - name THE specific market, THE specific stall, THE specific dish

## DISCOVERY & UNIQUENESS:
- **Go beyond the obvious**: Don't just list famous landmarks. Find SECRET spots locals treasure.
- **Specific over generic**: Instead of "try ramen" → "Try the miso ramen at Fuunji in Shinjuku - arrive 10:45am to beat the rush"
- **Unique experiences**: The tiny jazz bar in a basement, the family-run pottery studio, the trail locals use
- **Seasonal secrets**: What's special NOW that most guides miss?
- **Off-the-beaten-path**: For every famous spot, suggest a lesser-known alternative

${
  additionalNotes
    ? `## ⚠️ TRAVELER'S PRIORITY INSTRUCTIONS (MUST FOLLOW):
"${additionalNotes}"

Read the above CAREFULLY. This is the traveler's most important input. You MUST:
- Follow any exclusions (if they say no to something, don't include it)
- Follow any additions (if they want more of something, add it)
- Follow any changes (if they want different suggestions, give completely new ones)
- Interpret their intent and apply it throughout the entire itinerary`
    : ""
}

## GUIDED VS SELF-SERVE PREFERENCE:
${guidedPreference === 'prefer-guided' ? `
The traveler PREFERS GUIDED TOURS. For activities where guides add value (hiking, cultural experiences, adventure activities):
- ALWAYS recommend specific tour operators with URLs, costs, and booking info
- Search for and cite "best guided tours for [activity]" - include company names, ratings, what's included
- For hiking (e.g., Mt. Fuji), recommend specific guided climbing tours with mountain guides
- For cultural experiences, recommend guided walking tours, cooking classes with instructors, etc.
- Include: company name, approximate cost, duration, what's included, booking URL, why this operator
` : guidedPreference === 'self-serve' ? `
The traveler wants SELF-SERVE/DIY ONLY. No guided tours:
- Provide detailed self-guided instructions for every activity
- For hikes: trailhead access, route descriptions, timing, what to bring, hut reservations
- For cultural sites: self-guided audio tours, best times to visit solo, navigation tips
- Include: detailed step-by-step instructions, offline maps recommendations, essential apps
- Never recommend tour groups or guided experiences
` : `
The traveler is OPEN TO A MIX of guided and self-serve:
- Suggest guided tours for complex activities (multi-day hikes, cooking classes, adventure sports)
- Suggest DIY for simpler experiences (temple visits, neighborhood walks, food markets)
- Provide both options when relevant, letting them choose
`}

## RESEARCH & SPECIFICITY (CRITICAL):
For EVERY activity, you MUST include SPECIFIC details that prove deep research:
- **What makes it UNIQUE**: Why THIS place over the 10 others like it? What's the story?
- **Insider tips**: The table to request, the dish to order, the time to arrive, the secret menu item
- **Specific names**: Never "a local restaurant" → Always "[Restaurant Name] in [Neighborhood]"
- **Why NOW**: What's special about visiting this season/time?
- **The experience**: What will they SEE, SMELL, TASTE, FEEL? Paint the picture.
- **Practical info**: Cost estimates, booking URLs, lead times needed
${guidedPreference === 'prefer-guided' ? '- **Guided option**: Specific tour operator, what\'s included, cost, booking URL' : ''}

For TRAVEL & TRANSPORT:
- **How to book**: Specific instructions (e.g., "Use HyperDia.com or Google Maps for train times")
- **Nuanced details**: IC card vs paper tickets, reserved vs unreserved, which platform, transfer tips, what credit cards are accepted
- **Cost**: Approximate fares, whether railpasses covers it
- **Timing**: How long the journey takes, best departure times

## FORMATTING RULES (CRITICAL):
1. NEVER use asterisks (*) for bullet points - use hyphens (-) only
2. NEVER duplicate information (e.g., don't repeat "Total nights: 4 nights across Antigua" and "Cities with nights: Antigua (4 nights)")
3. Use proper indentation for nested bullets:
   - Top-level items start with "- "
   - Sub-items start with "  - " (2 spaces before dash)
   - Sub-sub-items start with "    - " (4 spaces before dash)
4. For bold text, use exactly two asterisks: **text** (not *text* or ***text***)
5. EVERY activity, tour, or experience MUST include a clickable URL. ONLY use these EXACT URL patterns:

   FOR PLACES/RESTAURANTS/ATTRACTIONS - Use Google Maps search:
   - Format: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY+COUNTRY
   - Example: [Mercado Roma](https://www.google.com/maps/search/?api=1&query=Mercado+Roma+Mexico+City)
   
   FOR GUIDED TOURS - Use GetYourGuide SEARCH (not deep links):
   - Format: https://www.getyourguide.com/s/?q=TOUR+DESCRIPTION+CITY
   - Example: [Teotihuacan Day Tour](https://www.getyourguide.com/s/?q=Teotihuacan+day+tour+Mexico+City)
   
   FOR FLIGHTS:
   - Use: https://www.google.com/flights
   
   FOR HOTELS/ACCOMMODATION - Use Booking.com SEARCH:
   - Format: https://www.booking.com/searchresults.html?ss=HOTEL+NAME+CITY
   - Example: [Hotel Nima](https://www.booking.com/searchresults.html?ss=Hotel+Nima+Mexico+City)
   
   FOR GENERAL INFO - Use Google search:
   - Format: https://www.google.com/search?q=SEARCH+TERMS
   
   ❌ NEVER use:
   - Made-up domains (cultured-foodie.com, tokyo-eats.com)
   - Deep links you're not 100% sure exist
   - Short URLs (goo.gl, bit.ly, maps.app.goo.gl)
   - Viator or TripAdvisor deep links (use search URLs instead)

## OUTPUT STRUCTURE:

### Trip Summary
- Theme: [Trip theme and overall feel]
- Duration: X nights total
- Route: **City1** (X nights) → **City2** (Y nights) → **City3** (Z nights)
- Budget: $X,XXX - $X,XXX total
  - Flights: $XXX
  - Accommodation: $XXX
  - Food & Activities: $XXX
- Top highlights:
  - [Highlight 1]
  - [Highlight 2]
  - [Highlight 3]

### Book First
- **Flights**: Best airlines, routes, target price around ${flightBudget}, when to book. [Search on Google Flights](https://www.google.com/flights)
- **Lodging that books out**: Mountain huts, popular ryokans, etc. Include booking URLs
- **Limited-availability activities**: Specific providers, URLs, costs, booking windows
- **Transport passes**: JR Pass, regional passes - where to buy, activation tips

${
  departureCity
    ? `Departing from: ${departureCity}
${flightDirectness === "nonstop" ? "Prioritize nonstop flights" : flightDirectness === "short-layover" ? "Short layovers OK" : "All options including long layovers"}`
    : ""
}

Accommodation budget: ${budgetInfo.label} (${budgetInfo.accommodation})

### Daily Itinerary

For each day, use this format:

**Day X: [Location] — [Theme]**

**Morning**
- **[Activity Name]**: What it is and why it's worth doing. Include timing (e.g., "8am-10am"). [Read more](https://relevant-url.com) or [Book here](https://booking-url.com)
- **Breakfast options**:
  - **[Restaurant 1]** - signature dish, price range. [View on Google Maps](https://maps.google.com/...)
  - **[Restaurant 2]** - signature dish, price range. [View on Google Maps](https://maps.google.com/...)

**Afternoon**
- **[Activity Name]**: Description, why this one specifically, practical details. Cost if applicable. [More info](https://url.com)
- **Lunch options**:
  - **[Restaurant 1]** - signature dish, neighborhood. [View on Google Maps](https://maps.google.com/...)
  - **[Restaurant 2]** - signature dish, neighborhood. [View on Google Maps](https://maps.google.com/...)
- **Afternoon drinks** (if applicable):
  - **[Bar/Brewery 1]** - what they're known for, vibe. [View on Google Maps](https://maps.google.com/...)
  - **[Bar/Brewery 2]** - specialty, atmosphere. [View on Google Maps](https://maps.google.com/...)

**Evening**
- **[Activity/Rest]**: Details and recommendations. [More info](https://url.com)
- **Dinner options**:
  - **[Restaurant 1]** - what to order, reserve ahead if popular. [View on Google Maps](https://maps.google.com/...)
  - **[Restaurant 2]** - cuisine style, price range. [View on Google Maps](https://maps.google.com/...)
- **Evening drinks** (if applicable):
  - **[Bar 1]** - cocktails, vibe, neighborhood. [View on Google Maps](https://maps.google.com/...)
  - **[Bar 2]** - specialty, atmosphere. [View on Google Maps](https://maps.google.com/...)

**Logistics**
- **Getting there**: Exact transport method (e.g., "Take JR Yamanote Line from Shibuya to Shinjuku, 5 min, ¥170")
- **How to book/check**: Specific tools (e.g., "Check times on [HyperDia](https://hyperdia.com) or Google Maps")
- **Tips**: Platform numbers, which exit, IC card usage, luggage forwarding if relevant

---

### High-Risk Days
- **Physically demanding**: Which days are tough and backup plans
- **Weather-sensitive**: What breaks if weather is bad, alternatives

### Near Misses
3 items max that almost made the cut:
- What it is, why cut, what it would replace

${guidedPreference === 'prefer-guided' || guidedPreference === 'some-guided' ? `### Alternative Guided Trips
For each tour company mentioned in the itinerary, list 1-2 of their OTHER highly-rated tours that might interest this traveler:
- **[Company Name]**: 
  - [Tour Name 1] - brief description, duration, price. [Book here](https://url.com)
  - [Tour Name 2] - brief description, duration, price. [Book here](https://url.com)

Only include companies actually referenced in the itinerary. Focus on tours that match the traveler's interests and vibe.
` : ''}
### Assumptions
- What you assumed about their preferences
- Any trade-offs made

Use **bold** for ALL place names, restaurants, and attractions. NEVER use single asterisks.`;

    // Build user prompt with PRIORITY on additional notes
    let inspirationContext = "";
    if (cities?.length > 0) {
      inspirationContext += `\nMUST-INCLUDE destinations: ${cities.join(", ")}`;
      inspirationContext += `\n\n**IMPORTANT**: You MUST include ALL the destinations listed above, but also ADD complementary nearby cities, regions, or day-trip destinations that would enhance this trip. Consider:
- Geographic proximity and efficient routing
- Cultural/experiential diversity (e.g., if they want Tokyo, add Kyoto for traditional Japan, Hakone for onsen + Mt. Fuji views)
- Seasonal highlights (e.g., cherry blossom spots, fall foliage areas)
- The traveler's interests and vibe preferences
- Trip duration - for 2+ weeks, definitely add 2-3 additional destinations
- Hidden gems and less-touristy alternatives that match their interests

For example: Tokyo 2 weeks → Include Kyoto (3-4 nights), day trips to Nikko, Kamakura, Hakone, possibly Osaka or Nara.`;
    }
    if (media?.length > 0) {
      inspirationContext += `\nThe traveler shared ${media.length} image(s) - analyze to identify what draws them and suggest destinations that match that aesthetic/vibe.`;
    }

    const userPrompt = `Plan my trip:

**DESTINATIONS**:${inspirationContext || "\nNo specific destinations - suggest the best destinations based on my vibe, interests, and trip duration"}

**DURATION**: ${durationContext}
**DATES**: ${dateContext}
**ACCOMMODATION BUDGET**: ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total daily)
**FLIGHT BUDGET**: ${flightBudget} round trip
${departureCity ? `**DEPARTING FROM**: ${departureCity}` : ""}

**MY VIBE**:${vibeContext}

${
  additionalNotes
    ? `**WHAT I SPECIFICALLY WANT**:
${additionalNotes}

^ These are my TOP PRIORITIES. Build the trip around these.`
    : ""
}

Give me an opinionated, actionable itinerary. Don't hedge - tell me what I should actually do.`;

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
