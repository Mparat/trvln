import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preferences } = await req.json();
    
    console.log('Received preferences:', JSON.stringify(preferences, null, 2));

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const { 
      media, cities, 
      budgetAccommodation, budgetFlight, 
      dateFlexibility, startDate, endDate, targetMonth,
      durationFlexibility, durationDays,
      departureCity, flightDirectness,
      atmosphere, adventureLevel, foodDrink, interests,
      additionalNotes 
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
    if (dateFlexibility === 'strict') {
      const daysFromDates = computeInclusiveDays(startDate, endDate);
      durationContext = daysFromDates ? `exactly ${daysFromDates} days` : "dates provided but duration unclear";
    } else {
      switch (durationFlexibility) {
        case 'weekend': durationContext = "2-3 day weekend trip"; break;
        case 'long-weekend': durationContext = "4-5 day long weekend"; break;
        case '1-week': durationContext = "7 day trip"; break;
        case '2-weeks': durationContext = "14 day trip"; break;
        case 'strict': durationContext = `exactly ${durationDays} days`; break;
        case 'flexible-days': durationContext = `approximately ${durationDays} days (±2 days flexible)`; break;
        default: durationContext = "flexible duration - suggest optimal length";
      }
    }

    // Build date context
    let dateContext = "";
    switch (dateFlexibility) {
      case 'strict': dateContext = startDate && endDate ? `Fixed dates: ${startDate} to ${endDate}` : "Specific dates (not provided)"; break;
      case 'flexible-days': dateContext = startDate ? `Around ${startDate} (±few days flexible)` : "Flexible around specific dates"; break;
      case 'month': dateContext = targetMonth ? `Target: ${targetMonth}` : "Specific month/season"; break;
      default: dateContext = "Anytime - recommend best time to visit";
    }

    // Build vibe context
    const vibeContext = `
Atmosphere preferences: ${atmosphere?.length > 0 ? atmosphere.join(', ') : 'No preference'}
Adventure level: ${adventureLevel || 'No preference'}
Food & drink: ${foodDrink?.length > 0 ? foodDrink.join(', ') : 'No preference'}
Interests (ranked): ${interests?.length > 0 ? interests.join(' > ') : 'No preference'}`;


    const systemPrompt = `You are an expert travel planner with strong opinions about what's worth doing.
Your output must be structured and decision-oriented, but include helpful details and explanations.

## CORE PRINCIPLES:
1. BE BOLD: Have strong opinions. Say "You MUST do X" not "You might consider X"
2. PRIORITIZE USER REQUESTS: The traveler's additional notes are SACRED. Build the itinerary around them.
3. QUALITY OVER QUANTITY: Better to deeply experience 3 things than rush through 8
4. LOCAL KNOWLEDGE: Skip tourist traps, include what locals actually do
5. REALISTIC PACING: Account for jet lag, travel time, getting lost

## CRITICAL REQUIREMENTS:
${additionalNotes ? `
THE TRAVELER EXPLICITLY REQUESTED:
"${additionalNotes}"

You MUST incorporate these requests into the core itinerary, not just mention them as options.
` : ''}

## RESEARCH & SPECIFICITY:
For EVERY activity, include:
- **What it is**: Brief description so traveler understands why it's special
- **Key details**: Timing, duration, difficulty, what to expect
- **Why this one**: Link to a blog post, travel article, or explain why this is the best option (e.g., "Ranked #1 on Japan-Guide.com" or "Recommended by Lonely Planet")
- **Practical info**: Cost estimates, booking URLs, lead times needed

For TRAVEL & TRANSPORT:
- **How to book**: Specific instructions (e.g., "Use HyperDia.com or Google Maps for train times")
- **Nuanced details**: IC card vs paper tickets, reserved vs unreserved, which platform, transfer tips
- **Cost**: Approximate fares, whether JR Pass covers it
- **Timing**: How long the journey takes, best departure times

## OUTPUT STRUCTURE:

### Trip Summary
- Trip theme and overall feel
- Total nights: X nights across Y cities
- Cities with nights: **Tokyo** (3) → **Kyoto** (4) → **Osaka** (2)
- Total estimated budget: $X,XXX - $X,XXX (breakdown: flights, accommodation, food, activities)
- Top 3 highlights of this trip
- Key things to book early (with why)

### Book First
Create an urgent, actionable booking priorities section:
- **Flights**: Best airlines, routes, target price around ${flightBudget}, when to book
- **Lodging that books out**: Mountain huts, popular ryokans, etc. Include booking URLs
- **Limited-availability activities**: Specific providers, URLs, costs, booking windows
- **Transport passes**: JR Pass, regional passes - where to buy, activation tips

${departureCity ? `Departing from: ${departureCity}
${flightDirectness === 'nonstop' ? 'Prioritize nonstop flights' : flightDirectness === 'short-layover' ? 'Short layovers OK' : 'All options including long layovers'}` : ''}

Accommodation budget: ${budgetInfo.label} (${budgetInfo.accommodation})

### Daily Itinerary

For each day, use this format:

**Day X: [Location] — [Theme]**

**Morning**
- **[Activity Name]**: What it is and why it's worth doing. Include timing (e.g., "8am-10am"). If applicable, cite source (blog, guide, article). Any booking/reservation needed.
- Breakfast: **[Restaurant]** - what to order, price range

**Afternoon**
- **[Activity Name]**: Description, why this one specifically, practical details. Cost if applicable.
- Lunch: **[Restaurant]** - signature dish, neighborhood

**Evening**
- **[Activity/Rest]**: Details and recommendations
- Dinner: **[Restaurant]** - reserve ahead if popular, what to order

**Logistics**
- **Getting there**: Exact transport method (e.g., "Take JR Yamanote Line from Shibuya to Shinjuku, 5 min, ¥170")
- **How to book/check**: Specific tools (e.g., "Check times on HyperDia.com or Google Maps")
- **Tips**: Platform numbers, which exit, IC card usage, luggage forwarding if relevant

---

### High-Risk Days
- **Physically demanding**: Which days are tough and backup plans
- **Weather-sensitive**: What breaks if weather is bad, alternatives

### Near Misses
3 items max that almost made the cut:
- What it is, why cut, what it would replace

### Assumptions
- What you assumed about their preferences
- Any trade-offs made

Use **bold** for ALL place names, restaurants, and attractions.`;

    // Build user prompt with PRIORITY on additional notes
    let inspirationContext = "";
    if (cities?.length > 0) {
      inspirationContext += `\nDestinations: ${cities.join(', ')}`;
    }
    if (media?.length > 0) {
      inspirationContext += `\nThe traveler shared ${media.length} image(s) - analyze to identify what draws them.`;
    }

    const userPrompt = `Plan my trip:

**DESTINATIONS**:${inspirationContext || '\nNo specific destinations - suggest based on my vibe'}

**DURATION**: ${durationContext}
**DATES**: ${dateContext}
**ACCOMMODATION BUDGET**: ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total daily)
**FLIGHT BUDGET**: ${flightBudget} round trip
${departureCity ? `**DEPARTING FROM**: ${departureCity}` : ''}

**MY VIBE**:${vibeContext}

${additionalNotes ? `**WHAT I SPECIFICALLY WANT**:
${additionalNotes}

^ These are my TOP PRIORITIES. Build the trip around these.` : ''}

Give me an opinionated, actionable itinerary. Don't hedge - tell me what I should actually do.`;

    // Build messages
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // Handle media (images/videos)
    const hasMedia = media && media.length > 0;
    
    if (hasMedia) {
      const content: any[] = [{ type: "text", text: userPrompt }];
      
      for (const item of media) {
        if (item.preview) {
          content.push({
            type: "image_url",
            image_url: { url: item.preview }
          });
        }
      }
      
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    console.log('Calling Lovable AI Gateway');

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
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), 
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), 
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to generate itinerary. Please try again." }), 
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error('Error in generate-itinerary function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
