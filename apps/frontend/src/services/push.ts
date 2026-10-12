/**
 * The browser's half of push notifications: whether this browser can take them,
 * the permission, and its push subscription. What the server knows of it goes
 * through `PantryStore`.
 *
 * The subscription lives on the service worker's registration, so there is
 * nothing to subscribe with in development, where the app runs without a worker.
 */

/** Why this browser cannot take notifications, or that it can. */
export type PushSupport =
  /** Ready, permission aside. */
  | 'supported'
  /** An iPhone or iPad: Safari offers push only to the app added to the Home Screen. */
  | 'needs-install'
  /** No push in this browser, or no service worker to receive it (development). */
  | 'unsupported';

function isAppleMobile(): boolean {
  // iPadOS reports itself as a Mac, but no Mac has a touch screen.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** The worker's registration, once it is active; `undefined` where there is none. */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  const registered = await navigator.serviceWorker.getRegistration();
  if (registered === undefined) return undefined;
  // `ready` waits for an active worker, which a registration found here will have soon.
  return registered.active === null ? navigator.serviceWorker.ready : registered;
}

export async function pushSupport(): Promise<PushSupport> {
  const hasApis = 'PushManager' in window && 'Notification' in window;
  if (!hasApis) return isAppleMobile() && !isInstalled() ? 'needs-install' : 'unsupported';
  return (await registration()) === undefined ? 'unsupported' : 'supported';
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied';
}

/** This browser's subscription, or `null` when it has none. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration())?.pushManager.getSubscription() ?? null;
}

/** Turning notifications on was refused, here or by the browser. */
export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`Notification permission is ${permission}`);
  }
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(key: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (key === null) return false;
  const bytes = new Uint8Array(key);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}

/**
 * Asks for permission if it has not been given, then subscribes with the
 * server's key. A subscription made with another key — a server whose pair was
 * replaced — would never be reached, so it is dropped and made again.
 */
export async function subscribe(publicKey: string): Promise<PushSubscriptionJSON> {
  const worker = await registration();
  if (worker === undefined) throw new Error('No service worker to subscribe with');

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') throw new PushPermissionError(permission);

  const key = fromBase64Url(publicKey);
  const existing = await worker.pushManager.getSubscription();
  if (existing !== null && !sameKey(existing.options.applicationServerKey, key)) {
    await existing.unsubscribe();
  }

  const subscription = await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return subscription.toJSON();
}

/** Drops this browser's subscription, so its push service stops taking anything for it. */
export async function unsubscribe(): Promise<void> {
  await (await currentSubscription())?.unsubscribe();
}

/** The time zone this device keeps, as an IANA name: what "today" is for its user. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
