import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schemas
const TripPreferencesSchema = z.object({
  media: z.array(z.object({
    type: z.enum(['image', 'video']),
    preview: z.string().max(10000).optional(),
    url: z.string().max(1000).optional(),
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

const FeedbackSchema = z.object({
  vote: z.enum(['up', 'down', 'neutral']).nullable(),
  comment: z.string().max(1000).nullable(),
});

const RequestSchema = z.object({
  itemContent: z.string().min(1).max(2000),
  itemContext: z.string().max(500),
  feedback: FeedbackSchema,
  fullItinerary: z.string().max(100000),
  tripPreferences: TripPreferencesSchema,
});


serve(async (req) => {
  if (req.method === 'OPTIONS') {
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

    const { itemContent, itemContext, feedback, fullItinerary, tripPreferences } = validationResult.data;
    console.log('Point update request:', { itemContent, itemContext, feedback });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build the prompt based on feedback type
    let instruction = '';
    
    if (feedback.vote === 'up') {
      // User likes it - just acknowledge, no change needed
      return new Response(
        JSON.stringify({ 
          updatedContent: itemContent,
          changed: false,
          reason: 'User approved this item'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else if (feedback.vote === 'down') {
      instruction = `The user DISLIKES this activity and wants a DIFFERENT alternative. 
${feedback.comment ? `Their feedback: "${feedback.comment}"` : 'Find a completely different option that fits the trip better.'}
Replace it with something better that matches their preferences.`;
    } else if (feedback.vote === 'neutral') {
      instruction = `The user is INDIFFERENT about this activity. 
${feedback.comment ? `Their note: "${feedback.comment}"` : ''}
If there's a clearly better option available, suggest it. Otherwise, keep the current recommendation but maybe enhance the description.`;
    }

    const systemPrompt = `You are a travel itinerary editor. You will be given a single itinerary item and feedback.
Your job is to provide an updated version of JUST that one item.

RULES:
1. Return ONLY the updated line item - no explanations, no extra text
2. Keep the same format (bullet point, bold names, links, etc.)
3. Use ONLY verified URL patterns:
   - Places: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY
   - Tours: https://www.getyourguide.com/s/?q=TOUR+CITY
   - Hotels: https://www.booking.com/searchresults.html?ss=HOTEL+CITY
4. Match the style and detail level of the original
5. Keep it contextually appropriate for: ${itemContext}`;

    // Build budget label
    const getBudgetLabel = (value?: number) => {
      if (!value) return "Moderate";
      if (value <= 25) return "Budget";
      if (value <= 50) return "Moderate";
      if (value <= 75) return "Comfortable";
      return "Luxury";
    };

    // Adventure level labels
    const adventureLabels: Record<string, string> = {
      'none': 'Relaxed',
      'family': 'Family-friendly',
      'active': 'Active',
      'adrenaline': 'Adrenaline junky'
    };

    const userPrompt = `CURRENT ITEM:
${itemContent}

FULL TRIP CONTEXT:
- Destinations: ${tripPreferences.cities?.join(', ') || 'Not specified'}
- Budget: ${getBudgetLabel(tripPreferences.budgetAccommodation)}
- Atmosphere: ${tripPreferences.atmosphere?.join(', ') || 'Balanced'}
- Adventure level: ${adventureLabels[tripPreferences.adventureLevel || ''] || tripPreferences.adventureLevel || 'Active'}
- Interests: ${tripPreferences.interests?.join(', ') || 'General'}
- Food preferences: ${tripPreferences.foodDrink?.join(', ') || 'Local cuisine'}
- Guided preference: ${tripPreferences.guidedPreference || 'Some guided'}
${tripPreferences.additionalNotes ? `- Additional notes: ${tripPreferences.additionalNotes}` : ''}

FEEDBACK:
${instruction}

Provide the updated item (just the line, nothing else):`;

    console.log('Calling Lovable AI for point update...');

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
        max_tokens: 500,
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
    const updatedContent = data.choices?.[0]?.message?.content?.trim() || itemContent;

    console.log('Point update complete:', updatedContent);

    return new Response(
      JSON.stringify({ 
        updatedContent,
        changed: updatedContent !== itemContent,
        reason: feedback.vote === 'down' ? 'Replaced with alternative' : 'Enhanced based on feedback'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in update-itinerary-item:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to update item' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
