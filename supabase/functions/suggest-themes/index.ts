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
    const { preferences } = await req.json();

    console.log("Suggesting themes for preferences:", JSON.stringify(preferences, null, 2));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const {
      cities,
      atmosphere,
      adventureLevel,
      foodDrink,
      interests,
      additionalNotes,
      durationFlexibility,
      durationDays,
    } = preferences;

    // Build context for theme suggestion
    const context = `
Destinations: ${cities?.length > 0 ? cities.join(", ") : "Not specified"}
Atmosphere: ${atmosphere?.length > 0 ? atmosphere.join(", ") : "Not specified"}
Adventure level: ${adventureLevel || "Not specified"}
Food & drink preferences: ${foodDrink?.length > 0 ? foodDrink.join(", ") : "Not specified"}
Interests (ranked): ${interests?.length > 0 ? interests.join(" > ") : "Not specified"}
Duration: ${durationFlexibility === "2-weeks" ? "2 weeks" : durationFlexibility === "1-week" ? "1 week" : `${durationDays} days`}
Additional notes: ${additionalNotes || "None"}
`.trim();

    const systemPrompt = `You are a travel expert. Based on the traveler's inputs, suggest 3 DISTINCT itinerary themes that would appeal to them.

Each theme should:
1. Be meaningfully different from the others (not just variations of the same thing)
2. Be relevant to what they've expressed interest in
3. Have a clear, evocative name (2-4 words max)
4. Include an appropriate emoji

Examples of good theme variety:
- For "Tokyo, food lover": "🍜 Ramen Pilgrimage", "🌸 Traditional Kyoto Side Trip", "🎮 Otaku & Gaming Culture"
- For "Italy honeymoon": "💕 Romantic Classics", "🍷 Wine Country Escape", "🏖️ Amalfi Coast Bliss"
- For "Peru adventure": "🏔️ Inca Trail Trek", "🌿 Amazon Jungle Immersion", "🍽️ Culinary Lima"

The themes should feel tailored to THIS specific traveler, not generic.

Respond with ONLY a JSON array of 3 objects, each with "id" (snake_case), "name", and "emoji" fields. No other text.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("Failed to suggest themes");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    console.log("Raw theme response:", content);

    // Parse JSON from response (handle markdown code blocks)
    let themes;
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        themes = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON array found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse themes:", parseError);
      // Fallback themes based on interests
      themes = [
        { id: "immersive_culture", name: "Deep Cultural Dive", emoji: "🎭" },
        { id: "adventure_nature", name: "Active Explorer", emoji: "🏔️" },
        { id: "local_flavors", name: "Local Food & Vibes", emoji: "🍜" },
      ];
    }

    // Ensure we have exactly 3 themes with required fields
    const validThemes = themes.slice(0, 3).map((t: any, i: number) => ({
      id: t.id || `theme_${i + 1}`,
      name: t.name || `Theme ${i + 1}`,
      emoji: t.emoji || ["🌟", "✨", "🎯"][i],
    }));

    console.log("Suggested themes:", validThemes);

    return new Response(JSON.stringify({ themes: validThemes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in suggest-themes function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});