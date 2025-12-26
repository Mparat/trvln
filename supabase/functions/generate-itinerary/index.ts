import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Scrape a link using Firecrawl to get actual content
async function scrapeLink(url: string, apiKey: string): Promise<string | null> {
  try {
    console.log('Scraping link:', url);
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });

    if (!response.ok) {
      console.error('Firecrawl error for', url, ':', response.status);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown;
    const metadata = data.data?.metadata || data.metadata;
    
    if (markdown || metadata) {
      let content = '';
      if (metadata?.title) content += `Title: ${metadata.title}\n`;
      if (metadata?.description) content += `Description: ${metadata.description}\n`;
      if (markdown) content += `Content: ${markdown.slice(0, 2000)}`; // Limit content length
      return content || null;
    }
    
    return null;
  } catch (error) {
    console.error('Error scraping link:', url, error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description, images, videos, links, durationRange, startDate, endDate, budget } = await req.json();
    
    console.log('Received request:', { 
      description, 
      imageCount: images?.length || 0,
      videoCount: videos?.length || 0,
      linkCount: links?.length || 0,
      durationRange, 
      startDate,
      endDate,
      budget 
    });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    const getBudgetInfo = (value: number) => {
      if (value <= 25) return { label: "Budget-friendly", range: "$0-$50/night" };
      if (value <= 50) return { label: "Moderate", range: "$50-$100/night" };
      if (value <= 75) return { label: "Comfortable", range: "$100-$200/night" };
      return { label: "Luxury", range: "$200-$500+/night" };
    };

    const budgetInfo = getBudgetInfo(budget);
    const durationStr = durationRange[0] === durationRange[1] 
      ? `${durationRange[0]}-day` 
      : `${durationRange[0]} to ${durationRange[1]}-day`;

    // Scrape links if Firecrawl is available
    let scrapedContent: string[] = [];
    if (links && links.length > 0 && FIRECRAWL_API_KEY) {
      console.log('Scraping', links.length, 'links with Firecrawl...');
      const scrapePromises = links.map((link: string) => scrapeLink(link, FIRECRAWL_API_KEY));
      const results = await Promise.all(scrapePromises);
      scrapedContent = results.filter((r): r is string => r !== null);
      console.log('Successfully scraped', scrapedContent.length, 'links');
    }

    const systemPrompt = `You are an expert travel planner with deep knowledge of destinations worldwide. Create detailed, personalized travel itineraries that are practical and inspiring.

Your itineraries should:
- Be organized by day and time of day (Morning, Afternoon, Evening)
- Include specific places to visit, restaurants to try, and activities to do
- Consider travel time between locations
- Include local tips and hidden gems
- Be realistic about what can be accomplished each day
- Reflect the traveler's budget level (${budgetInfo.label}, ${budgetInfo.range} accommodation) and preferences
- Include REAL place names that can be located on a map

Format your response with:
- Day headers (e.g., "## Day 1: Arrival & First Impressions")
- Time sections (Morning, Afternoon, Evening)
- Bullet points for specific activities and recommendations
- Include practical tips where relevant
- Bold important place names like **Temple Name** or **Restaurant Name**`;

    let mediaContext = '';
    if (images && images.length > 0) {
      mediaContext += `\nThe traveler has shared ${images.length} photo(s) of places they're interested in or want to visit.`;
    }
    if (videos && videos.length > 0) {
      mediaContext += `\nThe traveler has shared ${videos.length} video(s) for inspiration.`;
    }
    
    // Include scraped content from links
    if (scrapedContent.length > 0) {
      mediaContext += `\n\nThe traveler has shared social media posts for inspiration. Here is the extracted content from those posts:\n`;
      scrapedContent.forEach((content, i) => {
        mediaContext += `\n--- Post ${i + 1} ---\n${content}\n`;
      });
      mediaContext += `\nUse the locations, activities, and destinations mentioned in these posts to create the itinerary.`;
    } else if (links && links.length > 0) {
      // Fallback if scraping failed - at least mention the links
      mediaContext += `\nThe traveler has shared these social media links for inspiration:\n${links.map((l: string) => `- ${l}`).join('\n')}`;
    }

    const dateContext = startDate && endDate
      ? `Trip dates: ${startDate} to ${endDate}`
      : startDate 
        ? `Starting: ${startDate}` 
        : 'Flexible dates';

    const userPrompt = `Create a detailed ${durationStr} travel itinerary based on the following:

Destination/Description: ${description || "A wonderful travel destination based on any uploaded media or shared links"}
${dateContext}
Budget Level: ${budgetInfo.label} (${budgetInfo.range} for accommodation)
${mediaContext}

Please create a day-by-day itinerary with specific recommendations for activities, dining, and sightseeing. Include practical tips and local insights. Make sure to mention real, mappable locations with their proper names.`;

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