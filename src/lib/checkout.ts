import { supabase, functionHeaders } from '@/lib/supabase';

export type CreditPack = 'pack_2' | 'pack_10';

// After the Stripe redirect lands back here, the webhook has usually already
// credited the purchase — poll our own purchases row (RLS-scoped) briefly,
// then fall back to confirming with Stripe directly via confirm-checkout.
// Both paths are idempotent server-side, so racing the webhook is harmless.
export async function waitForPurchase(sessionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await supabase
      .from('purchases')
      .select('id')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();
    if (data) return true;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  try {
    const headers = await functionHeaders();
    // Payment endpoints are served as sub-routes of generate-itinerary — the
    // one function CI deploys. See supabase/functions/_shared/stripeHttp.ts.
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary/confirm-checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return !!data.applied;
  } catch {
    return false;
  }
}

// A purchase intent that survives the Google sign-in redirect, so a signed-out
// user who taps "Unlock" lands in Stripe right after coming back signed in.
const PENDING_CHECKOUT_KEY = 'trvln_pending_checkout';

export type PendingCheckout = { pack: CreditPack; unlockBatchId?: string };

export const savePendingCheckout = (intent: PendingCheckout) => {
  try { window.localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(intent)); } catch { /* best effort */ }
};

export const consumePendingCheckout = (): PendingCheckout | null => {
  try {
    const raw = window.localStorage.getItem(PENDING_CHECKOUT_KEY);
    window.localStorage.removeItem(PENDING_CHECKOUT_KEY);
    return raw ? JSON.parse(raw) as PendingCheckout : null;
  } catch {
    return null;
  }
};

export const clearPendingCheckout = () => {
  try { window.localStorage.removeItem(PENDING_CHECKOUT_KEY); } catch { /* best effort */ }
};

// Creates a Stripe Checkout session and sends the browser there. Requires a
// signed-in session — the caller handles sign-in first.
export async function startCheckout(pack: CreditPack, unlockBatchId?: string): Promise<void> {
  const headers = await functionHeaders();
  if (!headers.Authorization) throw new Error('Sign in to purchase');
  // Served as a sub-route of generate-itinerary — the one function CI deploys.
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary/create-checkout-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pack, unlockBatchId }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || 'Could not start checkout');
  }
  const { url } = await response.json();
  if (!url) throw new Error('Could not start checkout');
  window.location.href = url;
}
