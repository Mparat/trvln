import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TripPreferencesSchema = z.object({
  media: z.array(z.object({
    type: z.string().max(50),
    url: z.string().max(500),
    name: z.string().max(200).optional(),
  })).max(10).optional(),
  cities: z.array(z.string().max(100)).max(20).optional(),
  budgetAccommodation: z.number().min(0).max(100).optional(),
  budgetFlight: z.number().min(0).max(100).optional(),
  dateFlexibility: z.string().max(50).optional(),
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  targetMonth: z.string().max(50).optional(),
  durationFlexibility: z.string().max(50).optional(),
  durationDays: z.number().min(1).max(90).optional(),
  departureCity: z.string().max(100).optional(),
  flightDirectness: z.string().max(50).optional(),
  atmosphere: z.array(z.string().max(50)).max(10).optional(),
  adventureLevel: z.string().max(50).optional(),
  guidedPreference: z.string().max(50).optional(),
  foodDrink: z.array(z.string().max(50)).max(10).optional(),
  interests: z.array(z.string().max(50)).max(20).optional(),
  additionalNotes: z.string().max(5000).optional(),
});

const RequestSchema = z.object({
  editRequest: z.string().min(1).max(2000),
  currentItinerary: z.string().min(1).max(100000),
  themeTitle: z.string().max(200),
  tripPreferences: TripPreferencesSchema,
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { editRequest, currentItinerary, themeTitle, tripPreferences } = validationResult.data;
    console.log('Edit request:', editRequest);
    console.log('Theme:', themeTitle);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const getBudgetLabel = (value?: number) => {
      if (!value) return "Moderate";
      if (value <= 25) return "Budget";
      if (value <= 50) return "Moderate";
      if (value <= 75) return "Comfortable";
      return "Luxury";
    };

    const systemPrompt = `You are a travel itinerary editor. You will receive an existing itinerary and an edit request.
Your job is to apply the requested changes while preserving the overall structure and unaffected content.

FORMATTING RULES:
- Use the EXACT SAME formatting as the original itinerary
- Main sections: ## SECTION TITLE
- Day headers: ## Day N: Theme
- Sub-sections: ### Category Name
- Time periods: #### Morning / Afternoon / Evening
- ALL content under headers must be bullet points using "-" (never "*")
- 2-space indent for first level nesting, 4-space for second level
- NO loose paragraphs - everything is bullets
- Keep emojis in headers where appropriate

CONTENT RULES:
- Make ONLY the changes requested - preserve everything else exactly
- If the request is about a specific day/section, only modify that part
- Maintain the same level of detail and style
- Use verified URL patterns:
  - Places: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY
  - Tours: https://www.getyourguide.com/s/?q=TOUR+CITY
  - Hotels: https://www.booking.com/searchresults.html?ss=HOTEL+CITY

Return the COMPLETE updated itinerary with all sections.`;

    const userPrompt = `THEME: ${themeTitle}

TRIP CONTEXT:
- Destinations: ${tripPreferences.cities?.join(', ') || 'Not specified'}
- Duration: ${tripPreferences.durationDays || 7} days
- Budget: ${getBudgetLabel(tripPreferences.budgetAccommodation)}
- Atmosphere: ${tripPreferences.atmosphere?.join(', ') || 'Balanced'}
- Interests: ${tripPreferences.interests?.join(', ') || 'General'}
- Food preferences: ${tripPreferences.foodDrink?.join(', ') || 'Local cuisine'}

CURRENT ITINERARY:
${currentItinerary}

EDIT REQUEST:
${editRequest}

Apply the edit request and return the complete updated itinerary:`;

    console.log('Calling Lovable AI for itinerary edit...');

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
        max_tokens: 8000,
        temperature: 0.7,
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
    const updatedItinerary = data.choices?.[0]?.message?.content?.trim();

    if (!updatedItinerary) {
      throw new Error('No content returned from AI');
    }

    console.log('Itinerary edit complete, length:', updatedItinerary.length);

    return new Response(
      JSON.stringify({ updatedItinerary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in edit-itinerary:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to edit itinerary' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
