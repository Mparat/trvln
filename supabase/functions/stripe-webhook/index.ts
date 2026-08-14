import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyCheckoutSession, type CheckoutSession } from "../_shared/purchases.ts";

// No CORS and no user auth here — Stripe is the only caller, authenticated by
// the webhook signature. verify_jwt stays off in config.toml for that reason.

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    console.error("Stripe webhook is not configured");
    return new Response("not configured", { status: 500 });
  }

  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
  const signature = req.headers.get("stripe-signature");
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature ?? "",
      webhookSecret,
      undefined,
      cryptoProvider,
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
});
