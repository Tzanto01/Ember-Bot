import { currentUrl, navigate, queryString } from './navigation';
import { ApiError, toApiError } from './problem';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Options for one request. */
export interface RequestOptions {
  /** Query parameters; undefined values are left out. */
  params?: Record<string, string | undefined>;
  /** JSON body; null or undefined sends none. */
  body?: unknown;
  /** A replayed offline day edit: it triggers no reminder rebuild of its own (the replay ends with one). */
  replay?: boolean;
  /** The token store's own login and refresh: no bearer token and no refresh on 401. */
  skipBearer?: boolean;
}

/** A downloaded body with the response headers (for `Content-Disposition`). */
export interface Download {
  blob: Blob;
  headers: Headers;
}

/** Build settings: `native` switches cookies and XSRF off and bearer tokens on; `apiBase` prefixes `/api/` URLs. */
export interface HttpConfig {
  native: boolean;
  apiBase: string;
}

/** What the error handling needs from the session (`AuthService`). */
export interface HttpSession {
  signedIn(): boolean;
  clearSession(): void;
}

/** What the native bearer handling needs from the token store (`TokenStore`). */
export interface BearerTokens {
  readonly accessToken: string | null;
  /** Why the last refresh failed while the session was kept (network, 429, 5xx); null otherwise. */
  readonly lastTransientError: ApiError | null;
  refresh(): Promise<boolean>;
}

const reminderInputs = /\/api\/(habits|routines)(\/|\?|$)/;
const mutating = new Set<Method>(['POST', 'PUT', 'PATCH', 'DELETE']);

function isSameOrigin(url: string): boolean {
  return new URL(url, location.href).origin === location.origin;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return value.join('=');
    }
  }
  return null;
}

function withQuery(url: string, params: Record<string, string | undefined> = {}): string {
  const search = queryString(params);
  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * The app's fetch client. Every failure rejects with an `ApiError` (network failure: status 0).
 * Web: same-origin cookies and `X-XSRF-TOKEN` on relative mutating requests; a 403 `antiforgery` refreshes the
 * token and retries once. Native: no cookies, `Authorization: Bearer` on own `/api` calls and one single-flight
 * refresh plus retry on a 401 outside `/api/auth/*`. Both: a 401 outside `/api/auth/*` while signed in ends the
 * session and routes to `/login?returnUrl=…&reason=session`; 403 `consent_required` routes to `/consent`. Those two
 * errors are marked `handled`. A successful non-GET write to `/api/habits` that isn't a replay calls `onHabitWrite`.
 */
export class Http {
  /** Set by the composition root once the session exists. */
  session: HttpSession | null = null;
  /** Native build only: the token store. */
  bearer: BearerTokens | null = null;
  /** Called after a successful habit, day or pause write (native reminder rebuild). */
  onHabitWrite: (() => void) | null = null;
  /**
   * No-account mode: answers own `/api/` requests in process instead of `fetch` (`url` is the path with its query
   * string, without the API base). Null sends them to the server.
   */
  local: ((method: Method, url: string, body: unknown) => Promise<Response>) | null = null;

  constructor(private readonly config: HttpConfig) {}

  /** Sends a request and resolves with the parsed JSON body (undefined when empty). */
  async request<T>(method: Method, url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, url, options);
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ApiError(0, null);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, null);
    }
  }

  /** `GET` for a file: the body as a blob with the response headers. */
  async download(url: string, params?: Record<string, string | undefined>): Promise<Download> {
    const response = await this.send('GET', url, { params });
    try {
      return { blob: await response.blob(), headers: response.headers };
    } catch {
      throw new ApiError(0, null);
    }
  }

  private async send(
    method: Method,
    url: string,
    options: RequestOptions,
    retried = false,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.authorized(method, url, options);
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError(0, null);
    }
    if (response.ok) {
      if (method !== 'GET' && !options.replay && reminderInputs.test(url)) this.onHabitWrite?.();
      return response;
    }

    const error = toApiError(response.status, await readJson(response), response.headers);
    if (error.status === 403 && error.type === 'antiforgery' && !retried) {
      const refreshed = await this.authorized('GET', '/api/auth/antiforgery', {}).then(
        (r) => r.ok,
        () => false,
      );
      if (!refreshed) throw error;
      return this.send(method, url, options, true);
    }

    const session = this.session;
    if (error.status === 401 && !url.includes('/api/auth/') && session?.signedIn()) {
      session.clearSession();
      error.handled = true;
      navigate(`/login?${queryString({ returnUrl: currentUrl(), reason: 'session' })}`);
    } else if (error.status === 403 && error.type === 'consent_required') {
      error.handled = true;
      const here = currentUrl();
      if (!here.startsWith('/consent')) navigate(`/consent?${queryString({ returnUrl: here })}`);
    }
    throw error;
  }

  private isOwnApi(url: string): boolean {
    const base = this.config.apiBase;
    return url.startsWith('/api/') || (!!base && url.startsWith(`${base}/api/`));
  }

  private async authorized(method: Method, url: string, options: RequestOptions): Promise<Response> {
    const bearer = this.bearer;
    if (!this.config.native || !bearer || options.skipBearer || !this.isOwnApi(url)) {
      return this.exchange(method, url, options, null);
    }
    const response = await this.exchange(method, url, options, bearer.accessToken);
    if (response.status !== 401 || url.includes('/api/auth/')) return response;
    if (await bearer.refresh()) return this.exchange(method, url, options, bearer.accessToken);
    if (bearer.lastTransientError) throw bearer.lastTransientError;
    return response;
  }

  private exchange(
    method: Method,
    url: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    if (this.local && this.isOwnApi(url)) {
      const path = url.startsWith('/api/') ? url : url.slice(this.config.apiBase.length);
      return this.local(method, withQuery(path, options.params), options.body ?? null);
    }
    const headers = new Headers();
    const hasBody = options.body !== undefined && options.body !== null;
    if (hasBody) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const resolved = this.resolve(url, options.params);
    if (!this.config.native && mutating.has(method) && isSameOrigin(resolved)) {
      const xsrf = readCookie('XSRF-TOKEN');
      if (xsrf) headers.set('X-XSRF-TOKEN', xsrf);
    }
    return fetch(resolved, {
      method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      credentials: this.config.native ? 'omit' : 'same-origin',
    });
  }

  private resolve(url: string, params?: Record<string, string | undefined>): string {
    const full = withQuery(url, params);
    return this.config.apiBase && url.startsWith('/api/') ? this.config.apiBase + full : full;
  }
}
