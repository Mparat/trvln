import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PACKS, isPackKey } from "./packs.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

export type CheckoutSession = {
  id: string;
  payment_status?: string | null;
  amount_total?: number | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

// Credits the purchase (idempotently — apply_purchase no-ops on a session it
// has already seen) and spends one credit on the unlock batch when the session
// names one. Shared by the Stripe webhook and the confirm-checkout fallback,
// which may race each other for the same session.
export async function applyCheckoutSession(session: CheckoutSession): Promise<void> {
  const md = session.metadata ?? {};
  const userId = md.user_id || session.client_reference_id;
  if (!userId) {
    console.error(`Session ${session.id} has no user_id — cannot credit`);
    return;
  }
  const productKey = md.product_key;
  if (!isPackKey(productKey)) {
    console.error(`Session ${session.id} has unknown product_key ${productKey}`);
    return;
  }
  const paymentIntent = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  const { error } = await supabaseAdmin.rpc("apply_purchase", {
    p_session_id: session.id,
    p_user: userId,
    p_product_key: productKey,
    p_amount_cents: session.amount_total ?? 0,
    p_credits: PACKS[productKey].credits,
    p_payment_intent: paymentIntent,
    p_unlock_batch: md.unlock_batch_id || null,
  });
  if (error) throw new Error(`apply_purchase failed for ${session.id}: ${error.message}`);
  console.log(`Credited session ${session.id}: ${productKey} for user ${userId}` +
    (md.unlock_batch_id ? ` (unlocked batch ${md.unlock_batch_id})` : ""));
}
