import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Input validation schema
const PreferencesSchema = z.object({
  media: z.array(z.object({
    type: z.enum(['image', 'video']),
    preview: z.string().max(10000).optional(),
    url: z.string().max(1000).optional(),
    name: z.string().max(200).optional(),
  })).max(10).default([]),
  cities: z.array(z.string().max(100)).max(20).default([]),
  budgetAccommodation: z.number().min(0).max(100).default(50),
  budgetFlight: z.number().min(0).max(100).default(50),
  dateFlexibility: z.enum(['anytime', 'month', 'strict', 'flexible-days']).default('anytime'),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  targetMonth: z.string().max(50).default(''),
  durationFlexibility: z.enum(['weekend', 'long-weekend', '1-week', '2-weeks', 'strict', 'flexible-days', 'flexible']).default('1-week'),
  durationDays: z.number().min(1).max(90).default(7),
  noFlight: z.boolean().default(false),
  departureCity: z.string().max(100).default(''),
  flightDirectness: z.enum(['nonstop', 'short-layover', 'long-layover']).default('short-layover'),
  atmosphere: z.array(z.string().max(50)).max(10).default([]),
  adventureLevel: z.enum(['none', 'family', 'active', 'adrenaline']).default('active'),
  guidedPreference: z.enum(['self-guided', 'some-guided', 'fully-guided']).default('some-guided'),
  foodDrink: z.array(z.string().max(50)).max(10).default([]),
  interests: z.array(z.string().max(50)).max(20).default([]),
  additionalNotes: z.string().max(5000).default(''),
});

const RequestSchema = z.object({
  preferences: PreferencesSchema,
});


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

    const { preferences } = validationResult.data;
    console.log("Suggesting themes for preferences:", JSON.stringify(preferences, null, 2));

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

    // Build budget labels
    const getBudgetLabel = (value: number) => {
      if (value <= 25) return "Budget";
      if (value <= 50) return "Moderate";
      if (value <= 75) return "Comfortable";
      return "Luxury";
    };

    // Build duration context
    let durationContext = "";
    switch (durationFlexibility) {
      case "weekend": durationContext = "2-3 days"; break;
      case "long-weekend": durationContext = "4-5 days"; break;
      case "1-week": durationContext = "7 days"; break;
      case "2-weeks": durationContext = "14 days"; break;
      case "strict": durationContext = `exactly ${durationDays} days`; break;
      case "flexible-days":
      case "flexible": durationContext = `approximately ${durationDays} days (flexible)`; break;
      default: durationContext = `approximately ${durationDays} days`;
    }

    // Adventure level labels
    const adventureLabels: Record<string, string> = {
      'none': 'Relaxed',
      'family': 'Family-friendly',
      'active': 'Active',
      'adrenaline': 'Adrenaline junky'
    };

    // Build date context
    let dateContext = "";
    if (dateFlexibility === "strict" && startDate && endDate) {
      dateContext = `Fixed dates: ${startDate} to ${endDate}`;
    } else if (dateFlexibility === "month" && targetMonth) {
      dateContext = `Target month: ${targetMonth}`;
    } else {
      dateContext = "Flexible dates";
    }

    // Build flight context
    let flightContext = "";
    if (noFlight) {
      flightContext = "No flight needed (local/road trip)";
    } else {
      const flightPref = flightDirectness === "nonstop" ? "Nonstop preferred" : flightDirectness === "short-layover" ? "Short layovers OK" : "Long layovers OK";
      flightContext = `${departureCity ? `From ${departureCity}, ` : ""}${flightPref}`;
    }

    // Build context for theme suggestion with ALL user inputs
    const context = `
## INSPIRATION (Must-visit destinations)
Destinations: ${cities?.length > 0 ? cities.join(", ") : "Not specified - suggest destinations"}
Media/screenshots uploaded: ${media?.length > 0 ? `${media.length} inspiration images/videos` : "None"}

## LOGISTICS
Budget (Accommodation): ${getBudgetLabel(budgetAccommodation || 50)}
Budget (Flights): ${getBudgetLabel(budgetFlight || 50)}
Duration: ${durationContext}
Dates: ${dateContext}
${noFlight ? "No flight needed" : flightContext}

## VIBE
Atmosphere: ${atmosphere?.length > 0 ? atmosphere.join(", ") : "Not specified"}
Adventure level: ${adventureLabels[adventureLevel] || adventureLevel || "Not specified"}
Guided preference: ${guidedPreference || "some-guided"}
Food & drink preferences: ${foodDrink?.length > 0 ? foodDrink.join(", ") : "Not specified"}
Interests (ranked): ${interests?.length > 0 ? interests.join(" > ") : "Not specified"}

## ADDITIONAL NOTES
${additionalNotes || "None provided"}
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
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add more credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
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
      JSON.stringify({ error: "Unable to process request. Please try again." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
