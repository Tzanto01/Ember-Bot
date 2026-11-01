import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { bearerInterceptor } from './bearer.interceptor';
import { SECURE_STORE, SecureStore, TokenStore } from './token-store';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const tokens = (access: string, refresh: string) => ({
  tokenType: 'Bearer',
  accessToken: access,
  expiresIn: 900,
  refreshToken: refresh,
});

describe('bearerInterceptor with TokenStore', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let store: TokenStore;
  let secure: Map<string, string>;

  beforeEach(() => {
    secure = new Map();
    const fake: SecureStore = {
      get: async (key) => secure.get(key) ?? null,
      set: async (key, value) => void secure.set(key, value),
      remove: async (key) => void secure.delete(key),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bearerInterceptor])),
        provideHttpClientTesting(),
        { provide: SECURE_STORE, useValue: fake },
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TokenStore);
    localStorage.clear();
  });

  afterEach(() => mock.verify());

  async function signIn(persist = true, access = 'access-1', refresh = 'refresh-1') {
    const done = store.signIn('a@example.test', 'pw-synthetic', persist);
    await tick();
    const login = mock.expectOne('/api/auth/login');
    login.flush(tokens(access, refresh));
    await done;
    return login.request;
  }

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('posts the login without cookie flags and keeps the refresh token in secure storage only', async () => {
    const request = await signIn(true, 'access-1', 'refresh-secret');

    expect(request.params.keys()).toEqual([]);
    expect(request.body).toEqual({ email: 'a@example.test', password: 'pw-synthetic' });
    expect(secure.get('ember.refreshToken')).toBe('refresh-secret');
    expect(JSON.stringify({ ...localStorage })).not.toContain('refresh-secret');
    expect(store.accessToken).toBe('access-1');
  });

  it('attaches the bearer token to /api calls after sign-in', async () => {
    await signIn();

    void firstValueFrom(http.get('/api/habits'));

    const request = mock.expectOne('/api/habits');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-1');
    request.flush([]);
  });

  it('never sends the token to another origin', async () => {
    await signIn();

    void firstValueFrom(http.get('https://elsewhere.example/api/x'));

    const request = mock.expectOne('https://elsewhere.example/api/x');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it('keeps the refresh token out of secure storage when persist is off, yet still refreshes it', async () => {
    await signIn(false, 'access-1', 'session-refresh');
    expect(secure.size).toBe(0);

    const result = firstValueFrom(http.get('/api/habits'));
    mock.expectOne('/api/habits').flush(null, unauthorized);
    await tick();
    const refresh = mock.expectOne('/api/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'session-refresh' });
    refresh.flush(tokens('access-2', 'session-refresh-2'));
    await tick();
    const retry = mock.expectOne('/api/habits');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
    retry.flush([]);

    await expect(result).resolves.toEqual([]);
    expect(secure.size).toBe(0);
  });

  it('refreshes once for two concurrent 401s and retries both with the new token', async () => {
    await signIn();

    const first = firstValueFrom(http.get('/api/habits'));
    const second = firstValueFrom(http.get('/api/habits/2'));
    mock.expectOne('/api/habits').flush(null, unauthorized);
    mock.expectOne('/api/habits/2').flush(null, unauthorized);
    await tick();

    const refresh = mock.expectOne('/api/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
    refresh.flush(tokens('access-2', 'refresh-2'));
    await tick();

    const retries = mock.match((r) => r.url.startsWith('/api/habits'));
    expect(retries.map((r) => r.request.headers.get('Authorization'))).toEqual([
      'Bearer access-2',
      'Bearer access-2',
    ]);
    retries[0].flush([{ id: 1 }]);
    retries[1].flush({ id: 2 });

    await expect(first).resolves.toEqual([{ id: 1 }]);
    await expect(second).resolves.toEqual({ id: 2 });
    expect(secure.get('ember.refreshToken')).toBe('refresh-2');
  });

  it('clears the stored token when the refresh fails and passes the original 401 on', async () => {
    await signIn();

    const rejection = firstValueFrom(http.get('/api/habits')).catch((e: unknown) => e);
    mock.expectOne('/api/habits').flush(null, unauthorized);
    await tick();
    mock.expectOne('/api/auth/refresh').flush(null, unauthorized);

    const error = (await rejection) as HttpErrorResponse;
    expect(error.status).toBe(401);
    expect(error.url).toBe('/api/habits');
    expect(secure.size).toBe(0);
    expect(store.accessToken).toBeNull();
  });

  it.each([503, 429])(
    'passes the refresh error (%i) on and keeps the stored token when the refresh fails transiently',
    async (status) => {
      await signIn();

      const rejection = firstValueFrom(http.get('/api/habits')).catch((e: unknown) => e);
      mock.expectOne('/api/habits').flush(null, unauthorized);
      await tick();
      mock.expectOne('/api/auth/refresh').flush(null, { status, statusText: 'Transient' });

      const error = (await rejection) as HttpErrorResponse;
      expect(error.status).toBe(status);
      expect(error.url).toBe('/api/auth/refresh');
      expect(secure.get('ember.refreshToken')).toBe('refresh-1');
    },
  );

  it('never refreshes a 401 from the login endpoint', async () => {
    await signIn();

    const rejection = firstValueFrom(http.post('/api/auth/login', {})).catch((e: unknown) => e);
    mock.expectOne('/api/auth/login').flush({ detail: 'Failed' }, unauthorized);

    expect(((await rejection) as HttpErrorResponse).status).toBe(401);
    await tick();
    mock.expectNone('/api/auth/refresh');
  });
});
