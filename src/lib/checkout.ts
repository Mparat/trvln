import { functionHeaders } from '@/lib/supabase';

export type CreditPack = 'pack_2' | 'pack_10';

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
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, {
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
