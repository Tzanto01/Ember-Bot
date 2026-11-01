import { HttpClient, HttpContext, HttpContextToken } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { asApiError } from '../problem';

/** Marks the token store's own requests so the bearer interceptor leaves them alone. */
export const SKIP_BEARER = new HttpContextToken(() => false);

/** Where the refresh token lives: the platform's secure storage (Android Keystore, iOS Keychain). */
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The app's {@link SecureStore}: `@aparajita/capacitor-secure-storage`, loaded only in the native build. */
export const SECURE_STORE = new InjectionToken<SecureStore>('SECURE_STORE', {
  providedIn: 'root',
  factory: () => {
    const plugin = () => import('@aparajita/capacitor-secure-storage').then((m) => m.SecureStorage);
    return {
      get: async (key) => (await plugin()).getItem(key),
      set: async (key, value) => (await plugin()).setItem(key, value),
      remove: async (key) => (await plugin()).removeItem(key),
    };
  },
});

interface TokenResponse {
  tokenType: string;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const refreshKey = 'ember.refreshToken';

/**
 * Native bearer session (contract "Native app (Phase 7)"): the access token lives in memory only, the
 * refresh token only in secure storage (or in memory when "stay signed in" is off). Refresh is single flight.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly http = inject(HttpClient);
  private readonly secure = inject(SECURE_STORE);
  private access: string | null = null;
  private sessionRefresh: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private epoch = 0;

  /** The current access token, or null. */
  get accessToken(): string | null {
    return this.access;
  }

  /** `POST /api/auth/login` without cookie flags. Rejects with the login's `ApiError` (401 `Failed`/`NotAllowed`). */
  async signIn(email: string, password: string, persist: boolean): Promise<void> {
    await this.clear();
    const epoch = this.epoch;
    const tokens = await firstValueFrom(
      this.http.post<TokenResponse>(
        '/api/auth/login',
        { email, password },
        { context: this.context() },
      ),
    );
    if (epoch === this.epoch) await this.keep(tokens, persist);
  }

  /**
   * Gets a new access token with the refresh token (`POST /api/auth/refresh`). Concurrent callers share one
   * request. Resolves false when there is no refresh token or the refresh failed; only a refusal (400/401)
   * forgets the session, a network error, 429 or 5xx keeps it for a later try. A result that arrives after
   * `clear()` (logout, another sign-in) is discarded.
   */
  /** Why the last refresh failed when the session was kept (network error, 429 or 5xx); null otherwise. */
  lastTransientError: unknown = null;

  refresh(): Promise<boolean> {
    this.refreshing ??= this.runRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** Forgets both tokens, in memory and in secure storage. */
  async clear(): Promise<void> {
    this.epoch++;
    this.access = null;
    this.sessionRefresh = null;
    await this.secure
      .remove(refreshKey)
      .catch(() => this.secure.remove(refreshKey))
      .catch(() => undefined);
  }

  private async runRefresh(): Promise<boolean> {
    const epoch = this.epoch;
    const persisted = this.sessionRefresh === null;
    const refreshToken =
      this.sessionRefresh ?? (await this.secure.get(refreshKey).catch(() => null));
    this.lastTransientError = null;
    if (!refreshToken) return false;
    try {
      const tokens = await firstValueFrom(
        this.http.post<TokenResponse>(
          '/api/auth/refresh',
          { refreshToken },
          { context: this.context() },
        ),
      );
      if (epoch !== this.epoch) return false;
      await this.keep(tokens, persisted);
      return true;
    } catch (error) {
      const status = asApiError(error).status;
      if (status === 400 || status === 401) {
        if (epoch === this.epoch) await this.clear();
      } else {
        this.lastTransientError = error;
      }
      return false;
    }
  }

  private async keep(tokens: TokenResponse, persist: boolean): Promise<void> {
    this.access = tokens.accessToken;
    if (persist) {
      this.sessionRefresh = null;
      await this.secure.set(refreshKey, tokens.refreshToken);
    } else {
      this.sessionRefresh = tokens.refreshToken;
    }
  }

  private context(): HttpContext {
    return new HttpContext().set(SKIP_BEARER, true);
  }
}
