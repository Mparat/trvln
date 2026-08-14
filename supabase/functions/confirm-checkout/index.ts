import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyCheckoutSession } from "../_shared/purchases.ts";

// Deterministic fallback for a delayed or lost webhook: the returning client
// hands over its session_id, we verify payment state with Stripe directly and
// run the same idempotent crediting the webhook would have. Racing the webhook
// is harmless — apply_purchase no-ops on a session it has already seen.

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(auth.slice(7));
    const user = userData?.user;
    if (userError || !user) return json({ error: "Sign in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId.startsWith("cs_")) return json({ error: "Invalid session" }, 400);

    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) return json({ error: "Payments aren't available right now" }, 503);
    const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Only the buyer may confirm their own session.
    const sessionUser = session.metadata?.user_id || session.client_reference_id;
    if (sessionUser !== user.id) return json({ error: "Not your session" }, 403);
    if (session.payment_status !== "paid") {
      return json({ applied: false, status: session.payment_status });
    }

    await applyCheckoutSession(session);
    return json({
      applied: true,
      unlockBatchId: session.metadata?.unlock_batch_id ?? null,
    });
  } catch (error) {
    console.error("confirm-checkout error:", error);
    return json({ error: "Could not confirm purchase" }, 500);
  }
});
