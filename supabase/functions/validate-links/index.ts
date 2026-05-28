import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schemas
const LinkSchema = z.object({
  label: z.string().min(1).max(500),
  url: z.string().max(2000),
  context: z.string().max(500),
});

const RequestSchema = z.object({
  links: z.array(LinkSchema).max(20),
});

interface ValidatedLink {
  label: string;
  originalUrl: string;
  validatedUrl: string;
  source: string;
}


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

    const { links } = validationResult.data;
    
    if (!links || links.length === 0) {
      return new Response(
        JSON.stringify({ validatedLinks: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!perplexityApiKey) {
      console.error('PERPLEXITY_API_KEY not configured');
      // Return original links if Perplexity not available
      return new Response(
        JSON.stringify({ 
          validatedLinks: links.map(l => ({
            label: l.label,
            originalUrl: l.url,
            validatedUrl: l.url,
            source: 'original'
          }))
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Batch validate links - ask Perplexity for correct URLs
    const linksToValidate = links.slice(0, 10); // Limit to 10 links per request
    
    const prompt = `I need verified, working URLs for these travel activities/places. For each item, provide the BEST real URL from these sources (in order of preference):
1. Google Maps search link (format: https://www.google.com/maps/search/?api=1&query=PLACE+NAME+CITY)
2. Official website if it's a major attraction
3. GetYourGuide search (format: https://www.getyourguide.com/s/?q=SEARCH+TERMS)
4. Viator search (format: https://www.viator.com/searchResults/all?text=SEARCH+TERMS)

Items to find URLs for:
${linksToValidate.map((l, i) => `${i + 1}. "${l.label}" - Context: ${l.context}`).join('\n')}

Respond ONLY with a JSON array, no other text. Format:
[
  {"index": 1, "url": "https://...", "source": "google_maps|getyourguide|viator|official"},
  ...
]`;

    console.log('Validating links with Perplexity...');

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that finds verified URLs for travel destinations. Only return real, working URLs. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error('Perplexity API error:', response.status);
      // Return original links on error
      return new Response(
        JSON.stringify({ 
          validatedLinks: links.map(l => ({
            label: l.label,
            originalUrl: l.url,
            validatedUrl: l.url,
            source: 'original'
          }))
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log('Perplexity response:', content);

    // Parse the JSON response
    let validatedResults: { index: number; url: string; source: string }[] = [];
    try {
      // Extract JSON from response (might have extra text)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        validatedResults = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse Perplexity response:', parseError);
    }

    // Build validated links array
    const validatedLinks: ValidatedLink[] = linksToValidate.map((link, i) => {
      const result = validatedResults.find(r => r.index === i + 1);
      if (result && result.url) {
        return {
          label: link.label,
          originalUrl: link.url,
          validatedUrl: result.url,
          source: result.source || 'perplexity'
        };
      }
      // Fallback to Google Maps search if no result
      return {
        label: link.label,
        originalUrl: link.url,
        validatedUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(link.label + ' ' + link.context)}`,
        source: 'google_maps_fallback'
      };
    });

    // Add any remaining links that weren't validated
    const remainingLinks = links.slice(10).map(l => ({
      label: l.label,
      originalUrl: l.url,
      validatedUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.label + ' ' + l.context)}`,
      source: 'google_maps_fallback'
    }));

    return new Response(
      JSON.stringify({ validatedLinks: [...validatedLinks, ...remainingLinks] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error validating links:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to validate links. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
