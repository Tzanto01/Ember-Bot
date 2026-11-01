import { computed, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';
import { ApiClient } from './api-client';
import { Me } from './models';
import { asApiError } from './problem';

/**
 * Session store. Holds the signed-in user as a signal and owns the auth flows that touch
 * antiforgery, push subscriptions and navigation.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly swPush = inject(SwPush, { optional: true });

  private readonly meState = signal<Me | null>(null);
  private loaded = false;
  private inFlight: Promise<Me | null> | null = null;
  private consentPrompted = false;

  /** The signed-in user, or null. */
  readonly me = this.meState.asReadonly();

  /** True while a user is signed in. */
  readonly signedIn = computed(() => this.meState() !== null);

  /** True when health-data consent for the current policy version is missing. */
  readonly needsConsent = computed(() => {
    const consent = this.meState()?.consent;
    return !!consent && (!consent.given || consent.policyVersion !== consent.currentPolicyVersion);
  });

  /** `GET /api/auth/antiforgery`. Never throws: a failure only means the next unsafe call retries once. */
  async refreshAntiforgery(): Promise<void> {
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
    if (this.loaded && !force) return Promise.resolve(this.meState());
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
        this.meState.set(me);
        this.loaded = true;
        return me;
      })
      .finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  /** Replaces the cached `me`, for example with the result of `PATCH /api/me`. */
  setMe(me: Me): void {
    this.meState.set(me);
    this.loaded = true;
  }

  /** Forgets the session locally (the server already ended it). */
  clearSession(): void {
    this.meState.set(null);
    this.loaded = true;
  }

  /** Signs in with email and password, refreshes antiforgery and loads `me`. Rejects with `ApiError`. */
  async login(email: string, password: string, staySignedIn: boolean): Promise<Me | null> {
    await this.api.login({ email, password }, staySignedIn);
    await this.refreshAntiforgery();
    this.consentPrompted = true;
    return this.loadMe(true);
  }

  /**
   * Removes this device's push subscription (server first, then the browser), signs out,
   * refreshes antiforgery and goes to `/login`. Never throws.
   */
  async logout(): Promise<void> {
    await this.dropPushSubscription();
    try {
      await this.api.logout();
    } catch {
      /* ignored */
    }
    this.clearSession();
    this.consentPrompted = false;
    await this.refreshAntiforgery();
    await this.router.navigateByUrl('/login');
  }

  /** True once per app session when the consent step should be offered (used by the signed-in guard). */
  takeConsentPrompt(): boolean {
    if (this.consentPrompted) return false;
    this.consentPrompted = true;
    return this.needsConsent();
  }

  private async dropPushSubscription(): Promise<void> {
    if (!this.swPush?.isEnabled) return;
    const subscription = await firstValueFrom(
      this.swPush.subscription.pipe(
        timeout({ first: 3000 }),
        catchError(() => of(null)),
      ),
    );
    if (!subscription) return;
    try {
      await this.api.removePushSubscription(subscription.endpoint);
    } catch {
      /* ignored */
    }
    await this.swPush.unsubscribe().catch(() => undefined);
  }
}
