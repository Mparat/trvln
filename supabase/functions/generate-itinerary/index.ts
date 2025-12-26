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

    const systemPrompt = `You are an expert travel planner who helps people plan perfect trips. You have deep knowledge of destinations worldwide, including hidden gems, local favorites, and practical logistics.

Your job is to create a comprehensive, personalized itinerary that:
1. Covers as many requested destinations as efficiently possible
2. Includes places and activities the traveler might have missed
3. Provides practical booking information and links
4. Explains any trade-offs or constraints clearly
5. Suggests alternatives they might want to swap in

FORMAT YOUR RESPONSE WITH THESE SECTIONS:

## Trip Summary
- Total estimated cost breakdown (accommodation, food, activities, transport)
- Cities/regions covered with days in each
- Top 3-4 highlights

## Best Time to Visit
- Optimal season considering weather, crowds, prices
- Cheapest time to fly from their departure city
- Any festivals or events worth timing around
- What to pack

${departureCity ? `## Flight Details
- Recommended flights from ${departureCity}
- Approximate prices (budget: ${flightBudget})
- Best airports to fly into
- ${flightDirectness === 'nonstop' ? 'Focus on nonstop options' : flightDirectness === 'short-layover' ? 'Include options with short layovers' : 'Include all options including long layovers'}
- Booking tips` : ''}

## Accommodation Recommendations
- Specific hotel/hostel/Airbnb recommendations for each location
- Match the ${budgetInfo.label} budget level (${budgetInfo.accommodation})
- Include booking links where possible

## Day-by-Day Itinerary
For each day include:
- Morning, Afternoon, Evening activities
- Specific restaurant recommendations (multiple options)
- Realistic timing and travel between locations
- Bold **place names** that can be found on a map
- Pro tips and insider knowledge

## Near Misses (Almost Included)
- List 3-5 activities/places that were close to making the cut
- Explain why they weren't included and how to swap them in

## Assumptions & Trade-offs
- Clearly state any assumptions you made
- If budget conflicts with destination, explain options
- If time is insufficient, suggest alternatives
- If you had to skip requested places, explain why

Use **bold** for all place names, restaurant names, and attractions.
Include activity type tags like [Nature], [Culture], [Food], [Adventure], [Photo Op] after activities.
Link to sources where you got recommendations when possible.`;

    // Build user prompt
    let inspirationContext = "";
    if (cities?.length > 0) {
      inspirationContext += `\nDesired destinations: ${cities.join(', ')}`;
    }
    if (media?.length > 0) {
      inspirationContext += `\nThe traveler has shared ${media.length} image(s)/video(s) - analyze these to identify destinations and experiences they want.`;
    }

    const userPrompt = `Create a detailed travel itinerary based on:

INSPIRATION:${inspirationContext || '\nNo specific destinations - suggest based on preferences'}
${additionalNotes ? `\nAdditional notes: ${additionalNotes}` : ''}

LOGISTICS:
- Duration: ${durationContext}
- Dates: ${dateContext}
- Accommodation budget: ${budgetInfo.label} (${budgetInfo.accommodation}, ~${budgetInfo.daily} total)
- Flight budget: ${flightBudget} round trip
${departureCity ? `- Departing from: ${departureCity}` : ''}

VIBE:${vibeContext}

Please create a comprehensive travel plan following all the format requirements. Make sure to:
1. Include real, specific place names that can be located on a map
2. Provide multiple restaurant options for each meal
3. Be realistic about timing and what can be accomplished
4. Explain any trade-offs you had to make`;

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
