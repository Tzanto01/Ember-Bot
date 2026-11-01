import { computed, Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';
import { ApiClient } from './api-client';

/**
 * Web push for this device through the Angular service worker, which also shows the
 * notifications and handles their clicks from the payload. Call `check()` before reading `available`.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(ApiClient);
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly key = signal<string | null>(null);
  private checking: Promise<void> | null = null;
  private readonly current = toSignal(
    this.swPush?.isEnabled ? this.swPush.subscription : of<PushSubscription | null>(null),
    {
      initialValue: null,
    },
  );

  /** True when the service worker runs and the server offers push (false on 501 or any other failure). */
  readonly available = computed(() => !!this.swPush?.isEnabled && this.key() !== null);

  /** True when this browser holds a push subscription. */
  readonly subscribed = computed(() => this.current() !== null);

  /** Fetches the VAPID public key once. Never throws. */
  check(): Promise<void> {
    if (!this.swPush?.isEnabled) return Promise.resolve();
    this.checking ??= this.api.getVapidPublicKey().then(
      (key) => this.key.set(key || null),
      () => {
        this.checking = null;
      },
    );
    return this.checking;
  }

  /**
   * Re-registers this browser's subscription for the signed-in account, so a shared device follows whoever is
   * signed in. Never throws.
   */
  async claim(): Promise<void> {
    await this.check();
    const json = this.current()?.toJSON();
    const p256dh = json?.keys?.['p256dh'];
    const auth = json?.keys?.['auth'];
    if (!this.available() || !json?.endpoint || !p256dh || !auth) return;
    await this.api.addPushSubscription({ endpoint: json.endpoint, keys: { p256dh, auth } }).catch(() => undefined);
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
    const key = this.key();
    if (!this.swPush?.isEnabled || !key) return;
    const subscription = await this.swPush.requestSubscription({ serverPublicKey: key });
    const json = subscription.toJSON();
    const p256dh = json.keys?.['p256dh'];
    const auth = json.keys?.['auth'];
    try {
      if (!json.endpoint || !p256dh || !auth) throw new Error('Incomplete push subscription');
      await this.api.addPushSubscription({ endpoint: json.endpoint, keys: { p256dh, auth } });
    } catch (error) {
      await this.swPush.unsubscribe().catch(() => undefined);
      throw error;
    }
  }

  /** Removes the subscription on the server, then in the browser. Rejects with an `ApiError` when the server call fails. */
  async unsubscribe(): Promise<void> {
    const subscription = this.current();
    if (!this.swPush?.isEnabled || !subscription) return;
    await this.api.removePushSubscription(subscription.endpoint);
    await this.swPush.unsubscribe().catch(() => undefined);
  }

  /** Drops the browser subscription only, for when the server already removed it (account deleted). Never throws. */
  async forgetDevice(): Promise<void> {
    if (!this.swPush?.isEnabled || !this.current()) return;
    await this.swPush.unsubscribe().catch(() => undefined);
  }
}
