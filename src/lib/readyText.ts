// "Text me when it's ready" — opt-in state and the send call.
//
// Generating an itinerary takes a while, so people put the phone down or
// switch tabs while they wait. If they've left a number, the server texts
// them when a variant finishes. The number and opt-in live in localStorage so
// the choice survives reloads and pre-fills next trip.

const PHONE_KEY = 'trvln:readyTextPhone:v1';
const OPT_IN_KEY = 'trvln:readyTextOptIn:v1';

/**
 * Normalize what a person actually types into E.164, or null if it can't be.
 * A bare 10-digit number is assumed to be US/Canada — the hint text in the
 * dialog says so — and anything else needs an explicit country code.
 */
export const normalizePhone = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
};

/** Presentation form for a stored E.164 number: +1 (555) 123-4567 for NANP. */
export const formatPhone = (e164: string): string => {
  const match = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (match) return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
  return e164;
};

export const getSavedPhone = (): string => {
  try {
    return window.localStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
};

export const isReadyTextEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(OPT_IN_KEY) === 'on' && !!getSavedPhone();
  } catch {
    return false;
  }
};

export const enableReadyText = (phone: string): void => {
  try {
    window.localStorage.setItem(PHONE_KEY, phone);
    window.localStorage.setItem(OPT_IN_KEY, 'on');
  } catch {
    /* storage unavailable — the opt-in just won't survive a reload */
  }
};

export const disableReadyText = (): void => {
  try {
    window.localStorage.setItem(OPT_IN_KEY, 'off');
  } catch {
    /* ignore */
  }
};

/**
 * Text the saved number that a variant is ready. No-op unless the user opted
 * in. Failures are logged, never surfaced — by the time this fires the user
 * has the itinerary on screen anyway.
 */
export const sendReadyText = async (
  variant: { name: string; emoji: string },
  destination?: string,
): Promise<void> => {
  if (!isReadyTextEnabled()) return;
  const phone = getSavedPhone();
  if (!phone) return;

  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-ready-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        phone,
        themeName: variant.name.slice(0, 80),
        themeEmoji: variant.emoji.slice(0, 8),
        destination: (destination ?? '').slice(0, 80),
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      console.warn('Ready-text send failed:', detail?.error ?? response.status);
    }
  } catch (error) {
    console.warn('Ready-text send failed:', error);
  }
};
