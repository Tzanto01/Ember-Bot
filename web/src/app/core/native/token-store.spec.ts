import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SECURE_STORE, SecureStore, TokenStore } from './token-store';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('TokenStore', () => {
  let secure: Map<string, string>;
  let mock: HttpTestingController;
  let store: TokenStore;

  beforeEach(() => {
    secure = new Map();
    const fake: SecureStore = {
      get: async (key) => secure.get(key) ?? null,
      set: async (key, value) => void secure.set(key, value),
      remove: async (key) => void secure.delete(key),
    };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SECURE_STORE, useValue: fake }],
    });
    TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TokenStore);
  });

  afterEach(() => mock.verify());

  it('resolves false without a request when there is no refresh token', async () => {
    expect(await store.refresh()).toBe(false);
    mock.expectNone('/api/auth/refresh');
  });

  it('restores a session from the persisted refresh token after a restart', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    const refreshed = store.refresh();
    await tick();
    const request = mock.expectOne('/api/auth/refresh');
    expect(request.request.body).toEqual({ refreshToken: 'stored-refresh' });
    request.flush({ tokenType: 'Bearer', accessToken: 'access-9', expiresIn: 900, refreshToken: 'stored-refresh-2' });

    expect(await refreshed).toBe(true);
    expect(store.accessToken).toBe('access-9');
    expect(secure.get('ember.refreshToken')).toBe('stored-refresh-2');
  });

  it('forgets both tokens on clear', async () => {
    secure.set('ember.refreshToken', 'stored-refresh');

    await store.clear();

    expect(secure.size).toBe(0);
    expect(store.accessToken).toBeNull();
  });
});
