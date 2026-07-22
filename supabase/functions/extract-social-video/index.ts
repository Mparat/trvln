import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.object({
  url: z.string().url(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validation = RequestSchema.safeParse(body);

    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: "Invalid URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { url } = validation.data;

    const serviceUrl = Deno.env.get("SOCIAL_VIDEO_SERVICE_URL");
    if (!serviceUrl) {
      throw new Error("SOCIAL_VIDEO_SERVICE_URL is not configured");
    }

    console.log(`Extracting social video from: ${url}`);

    // Retry on 502/503: a sleeping/cold-starting host answers the first
    // request with its own gateway error page before the app is awake.
    let response: Response | null = null;
    let text = "";
    for (const delayMs of [0, 3000, 6000]) {
      if (delayMs > 0) {
        console.log(`Upstream ${response?.status} — retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
      response = await fetch(`${serviceUrl}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      text = await response.text();
      if (response.status !== 502 && response.status !== 503) break;
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch { /* upstream returned a non-JSON error page */ }

    if (!response!.ok) {
      // FastAPI errors use `detail`; host gateway error pages use `message`.
      // Surface whatever we got so the real failure reaches the user/logs.
      const upstream = data.detail ?? data.message ?? data.error;
      const detail = typeof upstream === "string" ? upstream : upstream ? JSON.stringify(upstream) : null;
      console.error(`Extract failed (${response!.status}):`, text.slice(0, 500));
      return new Response(
        JSON.stringify({ error: detail || `Video service unavailable (HTTP ${response!.status}) — the video extraction service isn't responding` }),
        { status: response!.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in extract-social-video:", error);
    return new Response(
      JSON.stringify({ error: "Unable to process request. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
