import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The client only supplies labels; the message itself is composed here so the
// function can't be used to text arbitrary content to arbitrary numbers.
const RequestSchema = z.object({
  // E.164: + followed by 8-15 digits, no leading zero
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Phone must be in international format, e.g. +15551234567"),
  themeName: z.string().min(1).max(80),
  themeEmoji: z.string().max(8).default(""),
  destination: z.string().max(80).default(""),
});

// Per-isolate cooldown so a stuck client (or someone poking the endpoint)
// can't rapid-fire texts at one number. Resets on cold start — a soft guard,
// not a billing firewall.
const lastSentAt = new Map<string, number>();
const COOLDOWN_MS = 60 * 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Two supported auth shapes, in order of preference:
    //  - API key: TWILIO_API_KEY_SID (SK...) + TWILIO_API_KEY_SECRET — revocable
    //    without rotating the account, so use this one when both are set.
    //  - Account auth token: TWILIO_AUTH_TOKEN.
    // TWILIO_ACCOUNT_SID (AC...) is required either way; it names the account
    // in the URL.
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

    const authUser = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
    const authPass = apiKeySid && apiKeySecret ? apiKeySecret : authToken;

    if (!accountSid || !authUser || !authPass || !fromNumber) {
      console.error("Twilio secrets not configured: need TWILIO_ACCOUNT_SID, TWILIO_FROM_NUMBER, and either TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN");
      return new Response(
        JSON.stringify({ error: "Text notifications aren't set up yet" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.errors.map(e => e.message) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { phone, themeName, themeEmoji, destination } = parsed.data;

    const last = lastSentAt.get(phone);
    if (last && Date.now() - last < COOLDOWN_MS) {
      return new Response(
        JSON.stringify({ error: "A text was just sent to this number — give it a minute" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title = `${themeEmoji ? `${themeEmoji} ` : ""}${themeName}`;
    const where = destination ? ` Your ${destination} itinerary is written.` : " Your itinerary is written.";
    const message = `${title} is ready!${where} Come back to Travellin' to take a look.`;

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${authUser}:${authPass}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, From: fromNumber, Body: message }),
      },
    );

    if (!twilioResponse.ok) {
      const detail = await twilioResponse.json().catch(() => ({}));
      console.error("Twilio send failed:", twilioResponse.status, detail);
      // Twilio's 400s (bad/unreachable number) are the caller's to fix;
      // anything else is on us.
      const status = twilioResponse.status === 400 ? 400 : 502;
      return new Response(
        JSON.stringify({ error: detail?.message || "Couldn't send the text" }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    lastSentAt.set(phone, Date.now());

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("send-ready-text error:", error);
    return new Response(
      JSON.stringify({ error: "Something went wrong" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
