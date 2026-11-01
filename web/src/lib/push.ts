import type { ApiClient } from './api-client';
import type { PushSubscriptionRequest } from './models';
import { Store } from './store';

/**
 * This page's service worker registration once it is active, or null when the browser has no push support or no
 * worker is registered (development, the mobile build) or none becomes ready within 3 seconds.
 */
export async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return null;
  if (!(await navigator.serviceWorker.getRegistration())) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
}

function toRequest(subscription: PushSubscription): PushSubscriptionRequest | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.['p256dh'];
  const auth = json.keys?.['auth'];
  return json.endpoint && p256dh && auth ? { endpoint: json.endpoint, keys: { p256dh, auth } } : null;
}

function serverKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return new Uint8Array([...atob(base64)].map((char) => char.charCodeAt(0)));
}

/**
 * Web push for this device through the service worker's `PushManager` (the worker in `sw.ts` shows the
 * notifications and handles their clicks). Call `check()` before reading `available`. Does nothing when
 * `registration` resolves null (no service worker, or the native build).
 */
export class PushService {
  private key: string | null = null;
  private checking: Promise<void> | null = null;

  /** True when the service worker runs and the server offers push (false on 501 or any other failure). */
  readonly available = new Store(false);

  /** True when this browser holds a push subscription. */
  readonly subscribed = new Store(false);

  constructor(
    private readonly api: ApiClient,
    private readonly registration: () => Promise<ServiceWorkerRegistration | null>,
  ) {}

  private async manager(): Promise<PushManager | null> {
    return (await this.registration().catch(() => null))?.pushManager ?? null;
  }

  private async current(manager: PushManager | null): Promise<PushSubscription | null> {
    const subscription = manager ? await manager.getSubscription().catch(() => null) : null;
    this.subscribed.set(subscription !== null);
    return subscription;
  }

  /** Reads this browser's subscription and fetches the VAPID public key once. Never throws. */
  check(): Promise<void> {
    this.checking ??= this.load().catch(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async load(): Promise<void> {
    const manager = await this.manager();
    if (!manager) throw new Error('No push support');
    await this.current(manager);
    this.key = (await this.api.getVapidPublicKey()) || null;
    this.available.set(this.key !== null);
  }

  /**
   * Re-registers this browser's subscription for the signed-in account, so a shared device follows whoever is
   * signed in. Never throws.
   */
  async claim(): Promise<void> {
    await this.check();
    const subscription = await this.current(await this.manager());
    const body = subscription && toRequest(subscription);
    if (!this.available.get() || !body) return;
    await this.api.addPushSubscription(body).catch(() => undefined);
  }

  /** True when the browser blocks notifications for this site. */
  isDenied(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'denied';
  }

  /**
   * Asks for permission, subscribes the browser and registers it with the server. Rejects with a
   * `DOMException` (for example `NotAllowedError` when permission is denied) or an `ApiError`.
   */
  async subscribe(): Promise<void> {
    const manager = await this.manager();
    if (!manager || !this.key) return;
    const subscription = await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey(this.key),
    });
    try {
      const body = toRequest(subscription);
      if (!body) throw new Error('Incomplete push subscription');
      await this.api.addPushSubscription(body);
      this.subscribed.set(true);
    } catch (error) {
      await subscription.unsubscribe().catch(() => undefined);
      this.subscribed.set(false);
      throw error;
    }
  }

  /** Removes the subscription on the server, then in the browser. Rejects with an `ApiError` when the server call fails. */
  async unsubscribe(): Promise<void> {
    const subscription = await this.current(await this.manager());
    if (!subscription) return;
    await this.api.removePushSubscription(subscription.endpoint);
    await this.forget(subscription);
  }

  /**
   * Logout: removes this device's subscription on the server (a failure is ignored), then in the browser.
   * Never throws.
   */
  async release(): Promise<void> {
    const subscription = await this.current(await this.manager());
    if (!subscription) return;
    await this.api.removePushSubscription(subscription.endpoint).catch(() => undefined);
    await this.forget(subscription);
  }

  /** Drops the browser subscription only, for when the server already removed it (account deleted). Never throws. */
  async forgetDevice(): Promise<void> {
    const subscription = await this.current(await this.manager());
    if (subscription) await this.forget(subscription);
  }

  private async forget(subscription: PushSubscription): Promise<void> {
    await subscription.unsubscribe().catch(() => undefined);
    this.subscribed.set(false);
  }
}
