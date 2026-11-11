import type { ApiClient } from './api-client';
import type { JournalApi } from './journal/types';
import type { Me } from './models';
import type { Reminders } from './native/reminders';
import type { TokenStore } from './native/token-store';
import { navigate } from './navigation';
import type { OfflineQueue } from './offline-queue';
import { asApiError } from './problem';
import type { PushService } from './push';
import { Store } from './store';
import { adoptAccountTheme, rememberAccountTheme, resetTheme, type ThemeId, themePicks } from './theme';

/** The native build's device state: bearer tokens and scheduled reminders. */
export interface NativeSession {
  tokens: TokenStore;
  reminders: Reminders;
}

const staySignedInKey = 'ember.staySignedIn';

function readStaySignedIn(): string | null {
  try {
    return localStorage.getItem(staySignedInKey);
  } catch {
    return null;
  }
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

  /**
   * Web build: the id of the user who signed in with a password and "Stay signed in" on this device (kept across app
   * starts), or null. Only then may the app keep that user's data on the device for an offline start.
   */
  readonly staySignedIn = new Store<string | null>(readStaySignedIn());

  /** The day journal; its key is restored after `me` loads and forgotten on sign-out, session end and wipe. */
  journal: Pick<JournalApi, 'forget' | 'restore'> | null = null;

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
   * Loads `me` once and caches it (`force` reloads) and adopts the account's theme. Resolves null when signed out (401);
   * rejects with `ApiError` on other failures, for example when offline.
   */
  loadMe(force = false): Promise<Me | null> {
    if (this.loaded && !force) return Promise.resolve(this.me.get());
    const session = this.session;
    const picks = themePicks();
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
        const unsaved = me && adoptAccountTheme(me.theme, picks);
        if (unsaved) void this.saveTheme(unsaved);
        if (me) void this.journal?.restore();
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

  private async saveTheme(theme: ThemeId): Promise<void> {
    const session = this.session;
    const me = await this.api.updateMe({ theme }).catch(() => null);
    if (!me || session !== this.session) return;
    rememberAccountTheme(me.theme);
    this.setMe(me);
  }

  /** Forgets the session locally (the server already ended it) and cancels the native build's reminders. */
  clearSession(): void {
    void this.native?.reminders.clearAll();
    void this.journal?.forget();
    this.session++;
    this.inFlight = null;
    this.me.set(null);
    this.loaded = true;
    this.setStaySignedIn(null);
  }

  private setStaySignedIn(userId: string | null): void {
    if (this.native) return;
    try {
      if (userId) localStorage.setItem(staySignedInKey, userId);
      else localStorage.removeItem(staySignedInKey);
    } catch {
      userId = null;
    }
    this.staySignedIn.set(userId);
  }

  /**
   * Signs in with email and password (and, after a `RequiresTwoFactor` answer, `twoFactor`), refreshes antiforgery
   * and loads `me`, and records {@link staySignedIn}. Rejects with `ApiError`; see `requiresTwoFactor()`.
   */
  async login(
    email: string,
    password: string,
    staySignedIn: boolean,
    twoFactor?: { code?: string; recoveryCode?: string },
  ): Promise<Me | null> {
    if (this.native) await this.native.tokens.signIn(email, password, staySignedIn, twoFactor);
    else {
      await this.api.login(
        { email, password, twoFactorCode: twoFactor?.code, twoFactorRecoveryCode: twoFactor?.recoveryCode },
        staySignedIn,
      );
    }
    await this.refreshAntiforgery();
    this.consentPrompted = true;
    const me = await this.loadMe(true);
    this.setStaySignedIn(staySignedIn && me ? me.id : null);
    return me;
  }

  /** Finishes a Discord sign-in that needs the second factor (`POST /api/auth/discord/2fa`), then loads `me`. */
  async completeDiscordTwoFactor(secret: { code: string } | { recoveryCode: string }): Promise<Me | null> {
    await this.api.discordTwoFactor(secret);
    await this.refreshAntiforgery();
    this.consentPrompted = true;
    return this.loadMe(true);
  }

  /**
   * Removes this device's push subscription (server first, then the browser), signs out,
   * refreshes antiforgery and goes to `/login`. `everywhere` ends every session of the account on every device
   * (in the native build too). Resolves false and keeps the session when the server couldn't end it (offline, 5xx, and
   * for `everywhere` any failure, a 401 included), because only the server can clear the auth cookie or the other sessions.
   * Never throws.
   */
  async logout(everywhere = false): Promise<boolean> {
    if (!this.native || everywhere) {
      await this.push?.release();
      try {
        await (everywhere ? this.api.logoutEverywhere() : this.api.logout());
      } catch (error) {
        if (everywhere || asApiError(error).status !== 401) return false;
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
   * Forgets this device's state for the signed-in user: queued offline edits, the habit cache and the journal key,
   * and in the native build the tokens and every scheduled reminder; shows the default theme again. Call before
   * `clearSession()`. Never throws.
   */
  async wipeDevice(): Promise<void> {
    const userId = this.me.get()?.id;
    await this.journal?.forget();
    if (this.native) {
      await this.native.reminders.clearAll();
      await this.native.tokens.clear();
    }
    if (userId) await this.queue.clear(userId);
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ember.channelsBeforePhone.') || key === 'ember.signupEmail')
      .forEach((key) => localStorage.removeItem(key));
    resetTheme();
  }

  /** True once per app session when the consent step should be offered (used by the signed-in guard). */
  takeConsentPrompt(): boolean {
    if (this.consentPrompted) return false;
    this.consentPrompted = true;
    return this.needsConsent();
  }
}
