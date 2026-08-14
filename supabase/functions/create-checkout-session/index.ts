import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PACKS, isPackKey } from "../_shared/packs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Success/cancel URLs are built from an allowlist, never from request input —
// a forged Origin header must not be able to bounce a paid session to an
// attacker's page.
function resolveOrigin(req: Request): string {
  const allowed = (Deno.env.get("CHECKOUT_ORIGIN_ALLOWLIST") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin");
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Sign in to purchase" }, 401);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(auth.slice(7));
    const user = userData?.user;
    if (userError || !user) return json({ error: "Sign in to purchase" }, 401);

    const body = await req.json().catch(() => ({}));
    const pack = body?.pack;
    if (!isPackKey(pack)) return json({ error: "Unknown pack" }, 400);

    const unlockBatchId = typeof body?.unlockBatchId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.unlockBatchId)
      ? body.unlockBatchId
      : undefined;

    if (unlockBatchId) {
      const { data: existing } = await supabaseAdmin
        .from("trip_entitlements")
        .select("batch_id")
        .eq("batch_id", unlockBatchId)
        .maybeSingle();
      if (existing) return json({ error: "This trip is already unlocked" }, 409);
    }

    const priceId = Deno.env.get(PACKS[pack].priceEnv);
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!priceId || !secretKey) {
      console.error("Stripe is not configured (missing price or secret key)");
      return json({ error: "Payments aren't available right now" }, 503);
    }

    const origin = resolveOrigin(req);
    if (!origin) {
      console.error("CHECKOUT_ORIGIN_ALLOWLIST is not configured");
      return json({ error: "Payments aren't available right now" }, 503);
    }

    const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        product_key: pack,
        ...(unlockBatchId ? { unlock_batch_id: unlockBatchId } : {}),
      },
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    return json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    return json({ error: "Could not start checkout" }, 500);
  }
});
