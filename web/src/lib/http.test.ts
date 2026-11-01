import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from './api-client';
import { AuthService } from './auth';
import { DeviceStore } from './device-store';
import { Http } from './http';
import { TokenStore } from './native/token-store';
import { setNavigator } from './navigation';
import { OfflineQueue } from './offline-queue';
import { ApiError } from './problem';
import { type FetchMock, me, memorySecureStore, mockFetch } from './test-support';

const web = { native: false, apiBase: '' };

function session(http: Http): AuthService {
  const queue = new OfflineQueue(new DeviceStore());
  const auth = new AuthService(new ApiClient(http, queue), queue, null, null);
  http.session = auth;
  return auth;
}

const setCookie = (value: string) => (document.cookie = `XSRF-TOKEN=${value}; path=/`);
const dropCookie = () =>
  (document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/');

let mock: FetchMock;
let navigate: Mock<(path: string) => void>;

beforeEach(() => {
  mock = mockFetch();
  navigate = vi.fn<(path: string) => void>();
  setNavigator(navigate);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setNavigator(null);
  dropCookie();
});

describe('Http URLs', () => {
  it('sends /api calls to the configured origin in the native build', async () => {
    const http = new Http({ native: true, apiBase: 'https://ember.example' });

    const result = http.request('GET', '/api/habits');
    (await mock.next('GET', 'https://ember.example/api/habits')).respond(200, []);

    await expect(result).resolves.toEqual([]);
  });

  it('leaves non-API paths relative', async () => {
    const http = new Http({ native: true, apiBase: 'https://ember.example' });

    const result = http.request('GET', '/legal/x.md');
    (await mock.next('GET', '/legal/x.md')).respond(200);

    await expect(result).resolves.toBeUndefined();
  });

  it('keeps /api calls relative when the base is empty (web build)', async () => {
    const http = new Http(web);

    const result = http.request('GET', '/api/habits');
    (await mock.next('GET', '/api/habits')).respond(200, []);

    await expect(result).resolves.toEqual([]);
  });

  it('URI-encodes query values and leaves out undefined ones', async () => {
    const http = new Http(web);

    void http.request('DELETE', '/api/me/push-subscriptions', {
      params: { endpoint: 'https://push.example.test/a b&c=1', from: undefined },
    });

    const call = await mock.next(
      'DELETE',
      '/api/me/push-subscriptions?endpoint=https%3A%2F%2Fpush.example.test%2Fa%20b%26c%3D1',
    );
    call.respond(204);
  });
});

describe('Http XSRF and cookies', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'sends the cookie token on a relative %s in the web build, with same-origin credentials',
    async (method) => {
      setCookie('token-1');
      void new Http(web).request(method, '/api/habits/1', { body: {} });

      const call = await mock.next(method, '/api/habits/1');
      expect(call.headers.get('X-XSRF-TOKEN')).toBe('token-1');
      expect(call.credentials).toBe('same-origin');
      call.respond(204);
    },
  );

  it('sends no XSRF header on a GET or to an absolute URL', async () => {
    setCookie('token-1');
    const http = new Http(web);

    void http.request('GET', '/api/habits');
    void http.request('POST', 'https://elsewhere.example/api/x', { body: {} });

    const get = await mock.next('GET', '/api/habits');
    const absolute = await mock.next('POST', 'https://elsewhere.example/api/x');
    expect(get.headers.has('X-XSRF-TOKEN')).toBe(false);
    expect(absolute.headers.has('X-XSRF-TOKEN')).toBe(false);
    get.respond(200, []);
    absolute.respond(204);
  });

  it('sends neither cookies nor an XSRF header in the native build', async () => {
    setCookie('token-1');

    void new Http({ native: true, apiBase: '' }).request('POST', '/api/habits', { body: {} });

    const call = await mock.next('POST', '/api/habits');
    expect(call.headers.has('X-XSRF-TOKEN')).toBe(false);
    expect(call.credentials).toBe('omit');
    call.respond(204);
  });
});

describe('Http errors', () => {
  const antiforgeryBody = { type: 'antiforgery' };

  it('refreshes the antiforgery token once and retries the POST with the new token, whose success reaches the caller', async () => {
    const http = new Http(web);
    setCookie('stale');
    const result = http.request<{ id: number }>('POST', '/api/habits', { body: { name: 'Walk' } });

    const first = await mock.next('POST', '/api/habits');
    expect(first.headers.get('X-XSRF-TOKEN')).toBe('stale');
    first.respond(403, antiforgeryBody);
    const antiforgery = await mock.next('GET', '/api/auth/antiforgery');
    setCookie('fresh');
    antiforgery.respond(204);
    const retry = await mock.next('POST', '/api/habits');
    expect(retry.headers.get('X-XSRF-TOKEN')).toBe('fresh');
    retry.respond(200, { id: 7 });

    await expect(result).resolves.toEqual({ id: 7 });
  });

  it('does not retry a second antiforgery failure and rejects with an ApiError', async () => {
    const rejection = new Http(web).request('POST', '/api/habits', { body: {} }).catch((e: unknown) => e);

    (await mock.next('POST', '/api/habits')).respond(403, antiforgeryBody);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('POST', '/api/habits')).respond(403, antiforgeryBody);

    const error = (await rejection) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.type).toBe('antiforgery');
    expect(mock.pending).toEqual([]);
  });

  it('rejects with the original error when the token refresh itself fails', async () => {
    const rejection = new Http(web).request('POST', '/api/habits', { body: {} }).catch((e: unknown) => e);

    (await mock.next('POST', '/api/habits')).respond(403, antiforgeryBody);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(500);

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(403);
    expect(error.type).toBe('antiforgery');
    expect(mock.pending).toEqual([]);
  });

  it('leaves a failed login alone: the session stays and nothing navigates', async () => {
    const http = new Http(web);
    const auth = session(http);
    auth.setMe(me);
    const rejection = http.request('POST', '/api/auth/login', { body: {} }).catch((e: unknown) => e);

    (await mock.next('POST', '/api/auth/login')).respond(401, { detail: 'Failed' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(401);
    expect(error.handled).toBe(false);
    expect(auth.me.get()).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ends the session and routes to /login with returnUrl on a 401 while signed in', async () => {
    window.history.pushState({}, '', '/history?month=2026-10');
    const http = new Http(web);
    const auth = session(http);
    auth.setMe(me);
    const rejection = http.request('GET', '/api/habits').catch((e: unknown) => e);

    (await mock.next('GET', '/api/habits')).respond(401, { type: 'unauthenticated' });

    const error = (await rejection) as ApiError;
    expect(error.handled).toBe(true);
    expect(auth.me.get()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      '/login?returnUrl=%2Fhistory%3Fmonth%3D2026-10&reason=session',
    );
    window.history.pushState({}, '', '/');
  });

  it('does not redirect a 401 when nobody is signed in', async () => {
    const http = new Http(web);
    session(http);
    const rejection = http.request('GET', '/api/habits').catch((e: unknown) => e);

    (await mock.next('GET', '/api/habits')).respond(401, { type: 'unauthenticated' });

    expect(((await rejection) as ApiError).handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes to /consent on consent_required and marks the error handled', async () => {
    window.history.pushState({}, '', '/today');
    const http = new Http(web);
    const auth = session(http);
    auth.setMe(me);
    const rejection = http.request('POST', '/api/habits', { body: {} }).catch((e: unknown) => e);

    (await mock.next('POST', '/api/habits')).respond(403, { type: 'consent_required' });

    const error = (await rejection) as ApiError;
    expect(error.handled).toBe(true);
    expect(auth.me.get()).not.toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/consent?returnUrl=%2Ftoday');
    window.history.pushState({}, '', '/');
  });

  it('passes other failures through as unhandled ApiErrors', async () => {
    const rejection = new Http(web).request('GET', '/api/habits/9').catch((e: unknown) => e);

    (await mock.next('GET', '/api/habits/9')).respond(404, { type: 'not_found' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(404);
    expect(error.handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads a network TypeError as an ApiError with status 0', async () => {
    const rejection = new Http(web).request('GET', '/api/habits').catch((e: unknown) => e);

    (await mock.next('GET', '/api/habits')).fail();

    const error = (await rejection) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });
});

describe('Http habit write hook', () => {
  it('calls onHabitWrite after a successful habit write, but not for a GET, a replay or a failure', async () => {
    const http = new Http(web);
    const onHabitWrite = vi.fn();
    http.onHabitWrite = onHabitWrite;

    const get = http.request('GET', '/api/habits');
    (await mock.next('GET', '/api/habits')).respond(200, []);
    await get;
    const replay = http.request('PUT', '/api/habits/1/days/2026-11-01', {
      body: { completed: true },
      replay: true,
    });
    (await mock.next('PUT', '/api/habits/1/days/2026-11-01')).respond(200, {});
    await replay;
    const failed = http.request('POST', '/api/habits/1/pause', { body: {} }).catch(() => null);
    (await mock.next('POST', '/api/habits/1/pause')).respond(500);
    await failed;
    expect(onHabitWrite).not.toHaveBeenCalled();

    const write = http.request('PUT', '/api/habits/1/days/2026-11-01', { body: { completed: true } });
    (await mock.next('PUT', '/api/habits/1/days/2026-11-01')).respond(200, {});
    await write;
    expect(onHabitWrite).toHaveBeenCalledTimes(1);
  });
});

describe('Http native bearer with TokenStore', () => {
  let http: Http;
  let store: TokenStore;
  let secure: Map<string, string>;

  const tokens = (access: string, refresh: string) => ({
    tokenType: 'Bearer',
    accessToken: access,
    expiresIn: 900,
    refreshToken: refresh,
  });

  beforeEach(() => {
    const memory = memorySecureStore();
    secure = memory.secure;
    http = new Http({ native: true, apiBase: '' });
    store = new TokenStore(http, memory.store);
    http.bearer = store;
    localStorage.clear();
  });

  async function signIn(persist = true, access = 'access-1', refresh = 'refresh-1') {
    const done = store.signIn('a@example.test', 'pw-synthetic', persist);
    const login = await mock.next('POST', '/api/auth/login');
    login.respond(200, tokens(access, refresh));
    await done;
    return login;
  }

  it('posts the login without cookie flags and keeps the refresh token in secure storage only', async () => {
    const login = await signIn(true, 'access-1', 'refresh-secret');

    expect(login.url).toBe('/api/auth/login');
    expect(login.body).toEqual({ email: 'a@example.test', password: 'pw-synthetic' });
    expect(login.headers.has('Authorization')).toBe(false);
    expect(secure.get('ember.refreshToken')).toBe('refresh-secret');
    expect(JSON.stringify({ ...localStorage })).not.toContain('refresh-secret');
    expect(store.accessToken).toBe('access-1');
  });

  it('attaches the bearer token to /api calls after sign-in', async () => {
    await signIn();

    void http.request('GET', '/api/habits');

    const request = await mock.next('GET', '/api/habits');
    expect(request.headers.get('Authorization')).toBe('Bearer access-1');
    request.respond(200, []);
  });

  it('never sends the token to another origin', async () => {
    await signIn();

    void http.request('GET', 'https://elsewhere.example/api/x');

    const request = await mock.next('GET', 'https://elsewhere.example/api/x');
    expect(request.headers.has('Authorization')).toBe(false);
    request.respond(200, {});
  });

  it('keeps the refresh token out of secure storage when persist is off, yet still refreshes it', async () => {
    await signIn(false, 'access-1', 'session-refresh');
    expect(secure.size).toBe(0);

    const result = http.request('GET', '/api/habits');
    (await mock.next('GET', '/api/habits')).respond(401);
    const refresh = await mock.next('POST', '/api/auth/refresh');
    expect(refresh.body).toEqual({ refreshToken: 'session-refresh' });
    refresh.respond(200, tokens('access-2', 'session-refresh-2'));
    const retry = await mock.next('GET', '/api/habits');
    expect(retry.headers.get('Authorization')).toBe('Bearer access-2');
    retry.respond(200, []);

    await expect(result).resolves.toEqual([]);
    expect(secure.size).toBe(0);
  });

  it('refreshes once for two concurrent 401s and retries both with the new token', async () => {
    await signIn();

    const first = http.request('GET', '/api/habits');
    const second = http.request('GET', '/api/habits/2');
    (await mock.next('GET', '/api/habits')).respond(401);
    (await mock.next('GET', '/api/habits/2')).respond(401);

    const refresh = await mock.next('POST', '/api/auth/refresh');
    expect(refresh.body).toEqual({ refreshToken: 'refresh-1' });
    refresh.respond(200, tokens('access-2', 'refresh-2'));

    const retryFirst = await mock.next('GET', '/api/habits');
    const retrySecond = await mock.next('GET', '/api/habits/2');
    expect(retryFirst.headers.get('Authorization')).toBe('Bearer access-2');
    expect(retrySecond.headers.get('Authorization')).toBe('Bearer access-2');
    retryFirst.respond(200, [{ id: 1 }]);
    retrySecond.respond(200, { id: 2 });

    await expect(first).resolves.toEqual([{ id: 1 }]);
    await expect(second).resolves.toEqual({ id: 2 });
    expect(mock.all.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
    expect(secure.get('ember.refreshToken')).toBe('refresh-2');
  });

  it('clears the stored token when the refresh fails and passes the original 401 on', async () => {
    await signIn();

    const rejection = http.request('GET', '/api/habits').catch((e: unknown) => e);
    (await mock.next('GET', '/api/habits')).respond(401, { detail: 'from habits' });
    (await mock.next('POST', '/api/auth/refresh')).respond(401, { detail: 'from refresh' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(401);
    expect(error.problem?.detail).toBe('from habits');
    expect(secure.size).toBe(0);
    expect(store.accessToken).toBeNull();
  });

  it.each([503, 429])(
    'passes the refresh error (%i) on and keeps the stored token when the refresh fails transiently',
    async (status) => {
      await signIn();

      const rejection = http.request('GET', '/api/habits').catch((e: unknown) => e);
      (await mock.next('GET', '/api/habits')).respond(401, { detail: 'from habits' });
      (await mock.next('POST', '/api/auth/refresh')).respond(status, { detail: 'from refresh' });

      const error = (await rejection) as ApiError;
      expect(error.status).toBe(status);
      expect(error.problem?.detail).toBe('from refresh');
      expect(secure.get('ember.refreshToken')).toBe('refresh-1');
    },
  );

  it('never refreshes a 401 from the login endpoint', async () => {
    await signIn();

    const rejection = http.request('POST', '/api/auth/login', { body: {} }).catch((e: unknown) => e);
    (await mock.next('POST', '/api/auth/login')).respond(401, { detail: 'Failed' });

    expect(((await rejection) as ApiError).status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve));
    expect(mock.all.some((c) => c.url === '/api/auth/refresh')).toBe(false);
  });

  it('refreshes and retries a 401 instead of ending the session, while the web build ends it', async () => {
    const auth = session(http);
    await signIn();
    auth.setMe(me);

    const result = http.request('GET', '/api/habits');
    (await mock.next('GET', '/api/habits')).respond(401);
    (await mock.next('POST', '/api/auth/refresh')).respond(200, tokens('access-2', 'refresh-2'));
    (await mock.next('GET', '/api/habits')).respond(200, []);

    await expect(result).resolves.toEqual([]);
    expect(auth.me.get()).toEqual(me);
    expect(navigate).not.toHaveBeenCalled();

    const webHttp = new Http(web);
    const webAuth = session(webHttp);
    webAuth.setMe(me);
    const ended = webHttp.request('GET', '/api/habits').catch((e: unknown) => e);
    (await mock.next('GET', '/api/habits')).respond(401);

    expect(((await ended) as ApiError).handled).toBe(true);
    expect(webAuth.me.get()).toBeNull();
    expect(mock.all.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('sends every native call, login and refresh included, to the absolute API base', async () => {
    const memory = memorySecureStore();
    const absolute = new Http({ native: true, apiBase: 'https://ember.example' });
    const absoluteTokens = new TokenStore(absolute, memory.store);
    absolute.bearer = absoluteTokens;
    const queue = new OfflineQueue(new DeviceStore());
    const api = new ApiClient(absolute, queue);

    const login = absoluteTokens.signIn('a@example.test', 'pw-synthetic', true);
    (await mock.next('POST', 'https://ember.example/api/auth/login')).respond(
      200,
      tokens('access-1', 'refresh-1'),
    );
    await login;
    const habits = api.listHabits();
    (await mock.next('GET', 'https://ember.example/api/habits')).respond(401);
    (await mock.next('POST', 'https://ember.example/api/auth/refresh')).respond(
      200,
      tokens('access-2', 'refresh-2'),
    );
    (await mock.next('GET', 'https://ember.example/api/habits')).respond(200, []);
    await habits;
    const days = api.getDays(1, '2026-10-01', '2026-10-31');
    (
      await mock.next('GET', 'https://ember.example/api/habits/1/days?from=2026-10-01&to=2026-10-31')
    ).respond(200, []);
    await days;

    expect(mock.all.length).toBe(5);
    expect(mock.all.every((c) => c.url.startsWith('https://ember.example/api/'))).toBe(true);
  });
});
