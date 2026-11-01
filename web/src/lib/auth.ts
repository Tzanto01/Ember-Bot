import type { ApiClient } from './api-client';
import type { Me } from './models';
import type { Reminders } from './native/reminders';
import type { TokenStore } from './native/token-store';
import { navigate } from './navigation';
import type { OfflineQueue } from './offline-queue';
import { asApiError } from './problem';
import type { PushService } from './push';
import { Store } from './store';

/** The native build's device state: bearer tokens and scheduled reminders. */
export interface NativeSession {
  tokens: TokenStore;
  reminders: Reminders;
}

/**
 * Session store. Holds the signed-in user in `me` and owns the auth flows that touch antiforgery, push
 * subscriptions, device state and navigation. `push` is the web build's push service (null in the native build);
 * `native` holds the native build's tokens and reminders (null on the web).
 */
export class AuthService {
  private loaded = false;
  private inFlight: Promise<Me | null> | null = null;
  private session = 0;
  private consentPrompted = false;

  /** The signed-in user, or null. */
  readonly me = new Store<Me | null>(null);

  constructor(
    private readonly api: ApiClient,
    private readonly queue: OfflineQueue,
    private readonly push: PushService | null,
    private readonly native: NativeSession | null,
  ) {}

  /** True while a user is signed in. */
  signedIn(): boolean {
    return this.me.get() !== null;
  }

  /** True when health-data consent for the current policy version is missing. */
  needsConsent(): boolean {
    const consent = this.me.get()?.consent;
    return !!consent && (!consent.given || consent.policyVersion !== consent.currentPolicyVersion);
  }

  /** `GET /api/auth/antiforgery` (web build only; the native app uses bearer tokens). Never throws. */
  async refreshAntiforgery(): Promise<void> {
    if (this.native) return;
    try {
      await this.api.antiforgery();
    } catch {
      return;
    }
  }

  /**
   * Loads `me` once and caches it (`force` reloads). Resolves null when signed out (401);
   * rejects with `ApiError` on other failures, for example when offline.
   */
  loadMe(force = false): Promise<Me | null> {
    if (this.loaded && !force) return Promise.resolve(this.me.get());
    const session = this.session;
    this.inFlight ??= this.api
      .getMe()
      .then(
        (me) => me,
        (error: unknown) => {
          const apiError = asApiError(error);
          if (apiError.status === 401) return null;
          throw apiError;
        },
      )
      .then((me) => {
        if (session !== this.session) return null;
        this.me.set(me);
        this.loaded = true;
        return me;
      })
      .finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** Replaces the cached `me`, for example with the result of `PATCH /api/me`. */
  setMe(me: Me): void {
    this.me.set(me);
    this.loaded = true;
  }

  /** Forgets the session locally (the server already ended it). */
  clearSession(): void {
    this.session++;
    this.inFlight = null;
    this.me.set(null);
    this.loaded = true;
  }

  /** Signs in with email and password, refreshes antiforgery and loads `me`. Rejects with `ApiError`. */
  async login(email: string, password: string, staySignedIn: boolean): Promise<Me | null> {
    if (this.native) await this.native.tokens.signIn(email, password, staySignedIn);
    else await this.api.login({ email, password }, staySignedIn);
    await this.refreshAntiforgery();
    this.consentPrompted = true;
    return this.loadMe(true);
  }

  /**
   * Removes this device's push subscription (server first, then the browser), signs out,
   * refreshes antiforgery and goes to `/login`. On the web, resolves false and keeps the session when the server
   * couldn't end it (offline, 5xx), because only the server can clear the auth cookie. Never throws.
   */
  async logout(): Promise<boolean> {
    if (!this.native) {
      await this.push?.release();
      try {
        await this.api.logout();
      } catch (error) {
        if (asApiError(error).status !== 401) return false;
      }
    }
    await this.wipeDevice();
    this.clearSession();
    this.consentPrompted = false;
    await this.refreshAntiforgery();
    navigate('/login');
    return true;
  }

  /**
   * Forgets this device's state for the signed-in user: queued offline edits and the habit cache, and in the
   * native build the tokens and every scheduled reminder. Call before `clearSession()`. Never throws.
   */
  async wipeDevice(): Promise<void> {
    const userId = this.me.get()?.id;
    if (this.native) {
      await this.native.reminders.clearAll();
      await this.native.tokens.clear();
    }
    if (userId) await this.queue.clear(userId);
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ember.channelsBeforePhone.'))
      .forEach((key) => localStorage.removeItem(key));
  }

  /** True once per app session when the consent step should be offered (used by the signed-in guard). */
  takeConsentPrompt(): boolean {
    if (this.consentPrompted) return false;
    this.consentPrompted = true;
    return this.needsConsent();
  }
}
