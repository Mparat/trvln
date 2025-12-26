import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description, images, videos, durationRange, startDate, endDate, budget, departureCity, flightPreference } = await req.json();
    
    console.log('Received request:', { 
      description, 
      imageCount: images?.length || 0,
      videoCount: videos?.length || 0,
      durationRange, 
      startDate,
      endDate,
      budget,
      departureCity,
      flightPreference
    });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const getBudgetInfo = (value: number) => {
      if (value <= 25) return { label: "Budget-friendly", range: "$0-$50/night", dailyBudget: "$50-80/day" };
      if (value <= 50) return { label: "Moderate", range: "$50-$100/night", dailyBudget: "$100-150/day" };
      if (value <= 75) return { label: "Comfortable", range: "$100-$200/night", dailyBudget: "$200-300/day" };
      return { label: "Luxury", range: "$200-$500+/night", dailyBudget: "$400-600+/day" };
    };

    const budgetInfo = getBudgetInfo(budget);
    const durationStr = durationRange[0] === durationRange[1] 
      ? `${durationRange[0]}-day` 
      : `${durationRange[0]} to ${durationRange[1]}-day`;

    const flightContext = departureCity 
      ? `\n\nFlight Information:
- Departing from: ${departureCity}
- Flight preference: ${flightPreference === 'nonstop' ? 'Nonstop flights only' : 'Any flights including layovers'}
- Include realistic flight options with approximate prices using Google Flights data patterns
- Suggest specific airlines and typical flight durations`
      : '';

    const systemPrompt = `You are an expert travel planner with deep knowledge of destinations worldwide. Create detailed, personalized travel itineraries that are practical and inspiring.

Your itineraries MUST include these sections in order:

## Trip Summary
Start with a brief summary including:
- Estimated daily budget (${budgetInfo.dailyBudget} based on ${budgetInfo.label} level)
- Cities/locations with number of days in each
- Top 3-4 key activities or highlights

## Best Time to Visit
Analyze and recommend:
1. **Overall best season/months** - considering weather, crowds, and experiences
2. **Cheapest time to fly** - based on typical flight pricing patterns
3. **Special events or festivals** - worth timing your trip around
4. **Weather considerations** - what to expect and pack

${departureCity ? `## Flight Details
Based on departing from ${departureCity}:
- Recommended airlines and approximate prices
- Flight duration and ${flightPreference === 'nonstop' ? 'nonstop options' : 'best connections'}
- Best airports to fly into
- Tips for booking (best days/times to book, how far in advance)` : ''}

## Detailed Day-by-Day Itinerary
Then provide the day-by-day plan:
- Be organized by day and time of day (Morning, Afternoon, Evening)
- Include specific places to visit, restaurants to try, and activities to do
- Consider travel time between locations
- Include local tips and hidden gems
- Be realistic about what can be accomplished each day
- Reflect the traveler's budget level (${budgetInfo.label}, ${budgetInfo.range} accommodation)
- Include REAL place names that can be located on a map

Format your response with:
- Clear section headers (## for main sections)
- Day headers (e.g., "## Day 1: Arrival & First Impressions")
- Time sections (Morning, Afternoon, Evening)
- Bullet points for specific activities and recommendations
- Bold important place names like **Temple Name** or **Restaurant Name**
- Include practical tips where relevant`;

    let mediaContext = '';
    if (images && images.length > 0) {
      mediaContext += `\nThe traveler has shared ${images.length} photo(s) showing places they're interested in or want to visit. Analyze these images carefully to identify the specific destination, landmarks, architecture, signage, and cultural elements.`;
    }
    if (videos && videos.length > 0) {
      mediaContext += `\nThe traveler has shared ${videos.length} video(s). IMPORTANT: Analyze the video content frame-by-frame to identify the EXACT destination shown - look for landmarks, architecture, signage, landscape features, language on signs, and cultural elements. Do NOT guess or assume a destination without visual evidence from the video.`;
    }

    const dateContext = startDate && endDate
      ? `Trip dates: ${startDate} to ${endDate}`
      : startDate 
        ? `Starting: ${startDate}` 
        : 'Flexible dates';

    const userPrompt = `Create a detailed ${durationStr} travel itinerary based on the following:

Destination/Description: ${description || "Analyze the uploaded images to determine the destination and create an itinerary"}
${dateContext}
Budget Level: ${budgetInfo.label} (${budgetInfo.range} for accommodation, approximately ${budgetInfo.dailyBudget} total)
${mediaContext}
${flightContext}

Please create a comprehensive travel plan with:
1. A trip summary with budget breakdown, cities, and highlights
2. Best time to visit analysis (seasons, pricing, events)
${departureCity ? '3. Flight recommendations from ' + departureCity : ''}
${departureCity ? '4' : '3'}. Day-by-day itinerary with specific recommendations

Make sure to mention real, mappable locations with their proper names in bold.`;

    // Build messages array
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // If there are images or videos, include them in the user message
    const hasMedia = (images && images.length > 0) || (videos && videos.length > 0);
    
    if (hasMedia) {
      const content: any[] = [
        { type: "text", text: userPrompt }
      ];
      
      // Add images
      if (images && images.length > 0) {
        for (const imageData of images) {
          content.push({
            type: "image_url",
            image_url: {
              url: imageData
            }
          });
        }
      }
      
      // Add videos - Gemini supports video via the same image_url format with data URLs
      if (videos && videos.length > 0) {
        for (const videoData of videos) {
          console.log('Adding video to request, data length:', videoData.length);
          content.push({
            type: "image_url",
            image_url: {
              url: videoData
            }
          });
        }
      }
      
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    console.log('Calling Lovable AI Gateway with model: google/gemini-2.5-flash');

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

    console.log('Streaming response back to client');

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
