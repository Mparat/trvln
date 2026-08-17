// The three payment HTTP handlers, shared between their standalone functions
// (supabase/functions/create-checkout-session etc.) and the sub-routes mounted
// under generate-itinerary. The sub-routes exist because the deploy workflow
// only ships generate-itinerary — workflow-file edits need a GitHub scope the
// automation tokens don't have — so riding along with it is what keeps the
// payment endpoints deployable from CI at all.
//
// Stripe is imported dynamically inside each handler so generate-itinerary's
// cold start doesn't pay for the SDK on ordinary generation requests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PACKS, isPackKey } from "./packs.ts";
import { applyCheckoutSession, type CheckoutSession } from "./purchases.ts";

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

// deno-lint-ignore no-explicit-any
async function loadStripe(): Promise<any> {
  const mod = await import("npm:stripe@17");
  return mod.default;
}

// Success/cancel URLs are built from an allowlist, never from request input —
// a forged Origin header must not be able to bounce a paid session to an
// attacker's page. A real origin that ISN'T allowlisted is refused loudly
// rather than silently falling back: the fallback once stranded a paying
// tester on a different domain than the one they bought from.
function resolveOrigin(req: Request): { origin: string; unauthorized?: string } {
  const allowed = (Deno.env.get("CHECKOUT_ORIGIN_ALLOWLIST") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && allowed.includes(requestOrigin)) return { origin: requestOrigin };
  if (requestOrigin) return { origin: "", unauthorized: requestOrigin };
  // No Origin header at all (rare non-browser caller): first allowlist entry.
  return { origin: allowed[0] ?? "" };
}

async function requireUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7));
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export async function handleCreateCheckoutSession(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Sign in to purchase" }, 401);

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

    const priceId = Deno.env.get(PACKS[pack as keyof typeof PACKS].priceEnv);
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!priceId || !secretKey) {
      console.error("Stripe is not configured (missing price or secret key)");
      return json({ error: "Payments aren't available right now" }, 503);
    }

    const { origin, unauthorized } = resolveOrigin(req);
    if (unauthorized) {
      console.error(`Checkout refused: origin ${unauthorized} is not in CHECKOUT_ORIGIN_ALLOWLIST`);
      return json({ error: "This site isn't authorized for purchases — add its URL to CHECKOUT_ORIGIN_ALLOWLIST" }, 403);
    }
    if (!origin) {
      console.error("CHECKOUT_ORIGIN_ALLOWLIST is not configured");
      return json({ error: "Payments aren't available right now" }, 503);
    }

    const Stripe = await loadStripe();
    const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
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
}

// Deterministic fallback for a delayed or lost webhook: the returning client
// hands over its session_id, we verify payment state with Stripe directly and
// run the same idempotent crediting the webhook would have.
export async function handleConfirmCheckout(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Sign in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId.startsWith("cs_")) return json({ error: "Invalid session" }, 400);

    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) return json({ error: "Payments aren't available right now" }, 503);
    const Stripe = await loadStripe();
    const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Only the buyer may confirm their own session.
    const sessionUser = session.metadata?.user_id || session.client_reference_id;
    if (sessionUser !== user.id) return json({ error: "Not your session" }, 403);
    if (session.payment_status !== "paid") {
      return json({ applied: false, status: session.payment_status });
    }

    await applyCheckoutSession(session as CheckoutSession);
    return json({
      applied: true,
      unlockBatchId: session.metadata?.unlock_batch_id ?? null,
    });
  } catch (error) {
    console.error("confirm-checkout error:", error);
    return json({ error: "Could not confirm purchase" }, 500);
  }
}

// No CORS and no user auth — Stripe is the only caller, authenticated by the
// webhook signature.
export async function handleStripeWebhook(req: Request): Promise<Response> {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook is not configured");
    return new Response("not configured", { status: 500 });
  }

  const Stripe = await loadStripe();
  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
  const signature = req.headers.get("stripe-signature");
  const payload = await req.text();

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature ?? "",
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as CheckoutSession;
        if (session.payment_status === "paid") {
          await applyCheckoutSession(session);
        }
        break;
      }
      case "charge.refunded": {
        // Dock the refunded pack's unspent credits. Refunds themselves are
        // issued manually in the Stripe dashboard.
        const charge = event.data.object as { payment_intent?: string | { id: string } | null };
        const pi = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (pi) {
          const { data: purchase } = await supabaseAdmin
            .from("purchases")
            .select("stripe_session_id")
            .eq("stripe_payment_intent", pi)
            .maybeSingle();
          if (purchase) {
            const { error } = await supabaseAdmin.rpc("dock_refund", {
              p_session_id: purchase.stripe_session_id,
            });
            if (error) throw new Error(`dock_refund failed: ${error.message}`);
            console.log(`Docked refund for session ${purchase.stripe_session_id}`);
          }
        }
        break;
      }
      default:
        // Not ours to handle; acknowledge so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry with backoff — correct for transient DB errors,
    // and harmless for permanent ones thanks to apply_purchase's idempotency.
    console.error(`Webhook handler failed for ${event.type}:`, err);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
