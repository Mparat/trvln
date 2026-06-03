import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.object({
  mediaUrls: z.array(z.string().url()).max(20),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validationResult = RequestSchema.safeParse(body);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return new Response(
        JSON.stringify({ error: "Invalid input", details: validationResult.error.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { mediaUrls } = validationResult.data;

    if (mediaUrls.length === 0) {
      return new Response(
        JSON.stringify({ destinations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");
    if (!GOOGLE_API_KEY) {
      throw new Error("GOOGLE_API_KEY is not configured");
    }

    console.log(`Analyzing ${mediaUrls.length} media items for location recognition`);

    const systemPrompt = `You are a travel location identification expert. Analyze the provided images and identify any travel destinations, landmarks, cities, or locations visible in them.

For each image, identify:
1. The specific location (city, landmark, region, country)
2. Confidence level: "high" (iconic/unmistakable), "medium" (likely but not certain), "low" (educated guess)
3. Brief reasoning for the identification

IMPORTANT GUIDELINES:
- Be specific: "Santorini, Greece" not just "Greece"
- Include landmarks when identifiable: "Eiffel Tower, Paris, France"
- If multiple locations are visible, list them all
- If you cannot identify a location, say so honestly
- Look for visual cues: architecture, signage, landscapes, famous landmarks, street styles

Return a JSON object with this exact structure:
{
  "destinations": [
    {
      "location": "City, Country" or "Landmark, City, Country",
      "confidence": "high" | "medium" | "low",
      "reasoning": "Brief explanation of how you identified this location"
    }
  ]
}

If no locations can be identified from any images, return:
{ "destinations": [] }`;

    // Build the content array with all images
    const content: any[] = [
      { 
        type: "text", 
        text: `Analyze these ${mediaUrls.length} travel inspiration image(s) and identify the locations shown. Return your response as a JSON object.` 
      }
    ];

    for (const url of mediaUrls) {
      content.push({
        type: "image_url",
        image_url: { url },
      });
    }

    console.log("Calling Google AI for vision analysis");

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "models/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Google AI error:", response.status, errorText);

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
        JSON.stringify({ error: "Failed to analyze images. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const responseContent = data.choices?.[0]?.message?.content || "{}";
    
    console.log("Raw AI response:", responseContent);

    let parsed;
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      console.error("Failed to parse AI response as JSON:", responseContent);
      parsed = { destinations: [] };
    }

    const destinations = parsed.destinations || [];
    console.log(`Identified ${destinations.length} destination(s):`, destinations);

    return new Response(
      JSON.stringify({ destinations }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in analyze-inspiration function:", error);
    return new Response(
      JSON.stringify({ error: "Unable to process request. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
