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
    const { description, images, duration, startDate, budget } = await req.json();
    
    console.log('Received request:', { 
      description, 
      imageCount: images?.length || 0, 
      duration, 
      startDate, 
      budget 
    });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const getBudgetLabel = (value: number) => {
      if (value <= 25) return "Budget-friendly";
      if (value <= 50) return "Moderate";
      if (value <= 75) return "Comfortable";
      return "Luxury";
    };

    const systemPrompt = `You are an expert travel planner with deep knowledge of destinations worldwide. Create detailed, personalized travel itineraries that are practical and inspiring.

Your itineraries should:
- Be organized by day and time of day (Morning, Afternoon, Evening)
- Include specific places to visit, restaurants to try, and activities to do
- Consider travel time between locations
- Include local tips and hidden gems
- Be realistic about what can be accomplished each day
- Reflect the traveler's budget level and preferences

Format your response with:
- Day headers (e.g., "## Day 1: Arrival & First Impressions")
- Time sections (Morning, Afternoon, Evening)
- Bullet points for specific activities and recommendations
- Include practical tips where relevant`;

    const userPrompt = `Create a detailed ${duration}-day travel itinerary based on the following:

Destination/Description: ${description || "A wonderful travel destination based on any uploaded images"}
${startDate ? `Start Date: ${startDate}` : 'Flexible dates'}
Budget Level: ${getBudgetLabel(budget)}
${images && images.length > 0 ? `\nNote: The traveler has shared ${images.length} photo(s) of places they're interested in or want to visit. Please consider these visual references when planning the itinerary.` : ''}

Please create a day-by-day itinerary with specific recommendations for activities, dining, and sightseeing. Include practical tips and local insights.`;

    // Build messages array
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    // If there are images, include them in the user message
    if (images && images.length > 0) {
      const content: any[] = [
        { type: "text", text: userPrompt }
      ];
      
      for (const imageData of images) {
        content.push({
          type: "image_url",
          image_url: {
            url: imageData
          }
        });
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
