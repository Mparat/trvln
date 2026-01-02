import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AddNearMissRequest {
  nearMissContent: string; // The Near Miss item to add
  fullItinerary: string; // Current itinerary for context
  tripPreferences: {
    // Inspiration
    media?: { type: string; url: string; name?: string }[];
    cities?: string[];
    // Logistics
    budgetAccommodation?: number;
    budgetFlight?: number;
    dateFlexibility?: string;
    startDate?: string;
    endDate?: string;
    targetMonth?: string;
    durationFlexibility?: string;
    durationDays?: number;
    departureCity?: string;
    flightDirectness?: string;
    // Vibe
    atmosphere?: string[];
    adventureLevel?: string;
    guidedPreference?: string;
    foodDrink?: string[];
    interests?: string[];
    // Notes
    additionalNotes?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nearMissContent, fullItinerary, tripPreferences } = await req.json() as AddNearMissRequest;

    console.log('Add Near Miss request:', { nearMissContent });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const systemPrompt = `You are a travel itinerary editor. A user wants to add a "Near Miss" item to their itinerary.

Your job is to:
1. Analyze the Near Miss item and the full itinerary
2. Determine the BEST placement (which Day and which time section: Morning, Afternoon, or Evening)
3. Format the item properly as an alternative option

RULES:
1. Return a JSON object with these fields:
   - "dayNumber": number (which day to insert, e.g., 1, 2, 3)
   - "section": string (one of: "Morning", "Afternoon", "Evening")
   - "insertAfterText": string (the exact text of an existing bullet point after which to insert, or empty string to add at end of section)
   - "formattedItem": string (the near miss formatted as a bullet with "**Alternative:**" prefix)
2. Choose placement based on activity type, timing, and logical flow
3. Use ONLY verified URL patterns for any links:
   - Places: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY
   - Tours: https://www.getyourguide.com/s/?q=TOUR+CITY
4. The formattedItem should start with "- **Alternative:** " to clearly mark it as an option`;

    // Build budget label
    const getBudgetLabel = (value?: number) => {
      if (!value) return "Moderate";
      if (value <= 25) return "Budget";
      if (value <= 50) return "Moderate";
      if (value <= 75) return "Comfortable";
      return "Luxury";
    };

    const userPrompt = `NEAR MISS ITEM TO ADD:
${nearMissContent}

CURRENT ITINERARY:
${fullItinerary}

FULL TRIP PREFERENCES:
- Destinations: ${tripPreferences.cities?.join(', ') || 'Not specified'}
- Budget: ${getBudgetLabel(tripPreferences.budgetAccommodation)}
- Atmosphere: ${tripPreferences.atmosphere?.join(', ') || 'Balanced'}
- Adventure level: ${tripPreferences.adventureLevel || 'Active'}
- Interests: ${tripPreferences.interests?.join(', ') || 'General'}
- Food preferences: ${tripPreferences.foodDrink?.join(', ') || 'Local cuisine'}
- Guided preference: ${tripPreferences.guidedPreference || 'Some guided'}
${tripPreferences.additionalNotes ? `- Additional notes: ${tripPreferences.additionalNotes}` : ''}

Analyze where this Near Miss fits best and return the JSON placement info:`;

    console.log('Calling Lovable AI for placement analysis...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Usage limit reached. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    console.log('AI response:', content);

    // Parse the JSON response
    let placement;
    try {
      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        placement = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback: add to Day 1 Afternoon
      placement = {
        dayNumber: 1,
        section: 'Afternoon',
        insertAfterText: '',
        formattedItem: `- **Alternative:** ${nearMissContent.replace(/^[-•]\s*/, '')}`
      };
    }

    console.log('Placement decision:', placement);

    return new Response(
      JSON.stringify({ 
        success: true,
        placement: {
          dayNumber: placement.dayNumber || 1,
          section: placement.section || 'Afternoon',
          insertAfterText: placement.insertAfterText || '',
          formattedItem: placement.formattedItem || `- **Alternative:** ${nearMissContent.replace(/^[-•]\s*/, '')}`
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in add-near-miss:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to add near miss' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
