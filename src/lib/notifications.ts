// Browser notifications for "your itinerary is ready".
//
// Generating an itinerary takes a while, so people switch tabs (or put the
// phone down) while they wait. A notification brings them back — but only if
// they asked for one: permission is requested from an explicit tap, never on
// page load, and the answer is remembered so we don't re-prompt next trip.

const OPT_IN_KEY = 'trvln:notifyWhenReady:v1';

export type NotifyStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

export const getNotifyStatus = (): NotifyStatus =>
  notificationsSupported() ? (Notification.permission as NotifyStatus) : 'unsupported';

// Permission alone isn't consent to ping: a user who granted it once may still
// want quiet on this trip, so the toggle is tracked separately.
export const isNotifyEnabled = (): boolean => {
  if (getNotifyStatus() !== 'granted') return false;
  try {
    return window.localStorage.getItem(OPT_IN_KEY) === 'on';
  } catch {
    return false;
  }
};

export const setNotifyEnabled = (on: boolean): void => {
  try {
    window.localStorage.setItem(OPT_IN_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable — the toggle just won't survive a reload */
  }
};

export const requestNotifyPermission = async (): Promise<NotifyStatus> => {
  if (!notificationsSupported()) return 'unsupported';
  try {
    // Safari's older implementation only takes a callback and returns
    // undefined; newer engines return a promise. Accept whichever arrives.
    const permission = await new Promise<NotificationPermission>((resolve) => {
      const maybePromise = Notification.requestPermission(resolve);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(() => resolve(Notification.permission));
      }
    });
    return (permission ?? Notification.permission) as NotifyStatus;
  } catch {
    return getNotifyStatus();
  }
};

type ReadyNotice = {
  title: string;
  body: string;
  /** Collapses repeats of the same event into one banner. */
  tag?: string;
};

/**
 * Fire a notification, but only if the user opted in *and* isn't already
 * looking at the page — an in-app toast already covers the visible case, and a
 * duplicate desktop banner on top of it is just noise.
 *
 * Returns whether a notification was actually shown.
 */
export const notifyWhenAway = async (notice: ReadyNotice): Promise<boolean> => {
  if (!isNotifyEnabled()) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false;

  const options: NotificationOptions = {
    body: notice.body,
    icon: '/icon-192.png',
    badge: '/favicon.svg',
    tag: notice.tag ?? 'trvln-itinerary-ready',
  };

  try {
    const notification = new Notification(notice.title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    // Android Chrome refuses the constructor outright and only allows
    // notifications through a service worker — use one if the app has
    // registered any, and otherwise stay quiet rather than throwing.
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) return false;
      await registration.showNotification(notice.title, options);
      return true;
    } catch {
      return false;
    }
  }
};
