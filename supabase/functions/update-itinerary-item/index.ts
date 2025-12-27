import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateRequest {
  itemContent: string;
  itemContext: string; // e.g., "Day 2: Rome > Morning"
  feedback: {
    vote: 'up' | 'down' | 'neutral';
    comment: string | null;
  };
  fullItinerary: string; // for context
  tripPreferences: {
    cities?: string[];
    atmosphere?: string[];
    interests?: string[];
    budgetAccommodation?: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemContent, itemContext, feedback, fullItinerary, tripPreferences } = await req.json() as UpdateRequest;

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

    const userPrompt = `CURRENT ITEM:
${itemContent}

TRIP CONTEXT:
- Destinations: ${tripPreferences.cities?.join(', ') || 'Not specified'}
- Interests: ${tripPreferences.interests?.join(', ') || 'General'}
- Atmosphere: ${tripPreferences.atmosphere?.join(', ') || 'Balanced'}

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
