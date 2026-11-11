import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Http } from '../http';
import { type FetchMock, memorySecureStore, mockFetch } from '../test-support';
import { capacitorSecureStore, TokenStore } from './token-store';

const tokens = (access: string, refresh: string) => ({
  tokenType: 'Bearer',
  accessToken: access,
  expiresIn: 900,
  refreshToken: refresh,
});

describe('TokenStore', () => {
  let secure: Map<string, string>;
  let mock: FetchMock;
  let store: TokenStore;

  beforeEach(() => {
    mock = mockFetch();
    const memory = memorySecureStore();
    secure = memory.secure;
    const http = new Http({ native: true, apiBase: '' });
    store = new TokenStore(http, memory.store);
    http.bearer = store;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resolves false without a request when there is no refresh token', async () => {
    expect(await store.refresh()).toBe(false);
    expect(mock.all).toEqual([]);
  });

  it('restores a session from the persisted refresh token after a restart', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    const refreshed = store.refresh();
    const request = await mock.next('POST', '/api/auth/refresh');
    expect(request.body).toEqual({ refreshToken: 'stored-refresh' });
    request.respond(200, tokens('access-9', 'stored-refresh-2'));

    expect(await refreshed).toBe(true);
    expect(store.accessToken).toBe('access-9');
    expect(secure.get('ember.refreshToken')).toBe('stored-refresh-2');
  });

  it('keeps the stored refresh token when the refresh fails with a server error', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    const refreshed = store.refresh();
    (await mock.next('POST', '/api/auth/refresh')).respond(503);

    expect(await refreshed).toBe(false);
    expect(secure.get('ember.refreshToken')).toBe('stored-refresh');
    expect(store.lastTransientError?.status).toBe(503);
  });

  it('forgets the stored refresh token when the server refuses it', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    const refreshed = store.refresh();
    (await mock.next('POST', '/api/auth/refresh')).respond(401);

    expect(await refreshed).toBe(false);
    expect(secure.size).toBe(0);
    expect(store.lastTransientError).toBeNull();
  });

  it('discards a refresh that completes after clear, so logout stays signed out', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    const refreshed = store.refresh();
    const request = await mock.next('POST', '/api/auth/refresh');
    await store.clear();
    request.respond(200, tokens('access-late', 'late-refresh'));

    expect(await refreshed).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(secure.size).toBe(0);
  });

  it('sends the two-factor code in the same bearer login call', async () => {
    const signedIn = store.signIn('a@example.test', 'pw-synthetic', true, { code: '123456' });
    const login = await mock.next('POST', '/api/auth/login');
    expect(login.body).toEqual({
      email: 'a@example.test',
      password: 'pw-synthetic',
      twoFactorCode: '123456',
    });
    login.respond(200, tokens('access-1', 'refresh-1'));
    await signedIn;

    expect(store.accessToken).toBe('access-1');
  });

  it('exchanges a native Discord code with its verifier and keeps the refresh token in secure storage', async () => {
    const signedIn = store.signInWithDiscord('code-synthetic', 'verifier-synthetic');
    const exchange = await mock.next('POST', '/api/auth/discord/native/token');
    expect(exchange.body).toEqual({ code: 'code-synthetic', verifier: 'verifier-synthetic' });
    exchange.respond(200, tokens('access-d', 'refresh-d'));
    await signedIn;

    expect(store.accessToken).toBe('access-d');
    expect(secure.get('ember.refreshToken')).toBe('refresh-d');
  });

  it('forgets both tokens on clear', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    await store.clear();

    expect(secure.size).toBe(0);
    expect(store.accessToken).toBeNull();
  });
});

vi.mock('@aparajita/capacitor-secure-storage', async () => ({
  SecureStorage: (await import('../test-support')).capacitorPlugin({
    getItem: async () => 'stored-refresh',
  }),
}));

describe('capacitorSecureStore', () => {
  it('reads through the native plugin proxy without awaiting the proxy itself', async () => {
    expect(await capacitorSecureStore.get('ember.refreshToken')).toBe('stored-refresh');
  });
});
