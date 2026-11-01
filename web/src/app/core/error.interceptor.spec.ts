import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { errorInterceptor } from './error.interceptor';
import { Me } from './models';
import { ApiError } from './problem';

const me: Me = {
  id: 'u1',
  email: 'a@example.test',
  emailConfirmed: true,
  hasPassword: true,
  discord: { linked: false, id: null },
  timezone: 'Europe/Berlin',
  timezoneSet: true,
  localToday: '2026-11-01',
  graceDaysPerWeek: 1,
  leaderboardOptIn: false,
  consent: { given: true, policyVersion: '1', currentPolicyVersion: '1' },
  dmReminders: { paused: false },
};

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([errorInterceptor]),
          withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
        ),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => httpMock.verify());

  const antiforgeryBody = { type: 'antiforgery' };

  it('refreshes the antiforgery token once and retries the POST, whose success reaches the caller', async () => {
    const result = firstValueFrom(http.post<{ id: number }>('/api/habits', { name: 'Walk' }));

    httpMock
      .expectOne({ method: 'POST', url: '/api/habits' })
      .flush(antiforgeryBody, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne({ method: 'GET', url: '/api/auth/antiforgery' }).flush(null);
    httpMock.expectOne({ method: 'POST', url: '/api/habits' }).flush({ id: 7 });

    await expect(result).resolves.toEqual({ id: 7 });
  });

  it('does not retry a second antiforgery failure and rejects with an ApiError', async () => {
    const result = firstValueFrom(http.post('/api/habits', {}));
    const rejection = result.catch((e: unknown) => e);

    httpMock
      .expectOne({ method: 'POST', url: '/api/habits' })
      .flush(antiforgeryBody, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne({ method: 'GET', url: '/api/auth/antiforgery' }).flush(null);
    httpMock
      .expectOne({ method: 'POST', url: '/api/habits' })
      .flush(antiforgeryBody, { status: 403, statusText: 'Forbidden' });

    const error = (await rejection) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.type).toBe('antiforgery');
    httpMock.expectNone('/api/auth/antiforgery');
  });

  it('rejects with the original error when the token refresh itself fails', async () => {
    const rejection = firstValueFrom(http.post('/api/habits', {})).catch((e: unknown) => e);

    httpMock
      .expectOne({ method: 'POST', url: '/api/habits' })
      .flush(antiforgeryBody, { status: 403, statusText: 'Forbidden' });
    httpMock
      .expectOne('/api/auth/antiforgery')
      .flush(null, { status: 500, statusText: 'Server Error' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(403);
    httpMock.expectNone({ method: 'POST', url: '/api/habits' });
  });

  it('leaves a failed login alone: the session stays and nothing navigates', async () => {
    auth.setMe(me);
    const rejection = firstValueFrom(http.post('/api/auth/login', {})).catch((e: unknown) => e);

    httpMock
      .expectOne('/api/auth/login')
      .flush({ detail: 'Failed' }, { status: 401, statusText: 'Unauthorized' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(401);
    expect(error.handled).toBe(false);
    expect(auth.me()).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ends the session and routes to /login with returnUrl on a 401 while signed in', async () => {
    auth.setMe(me);
    const rejection = firstValueFrom(http.get('/api/habits')).catch((e: unknown) => e);

    httpMock
      .expectOne('/api/habits')
      .flush({ type: 'unauthenticated' }, { status: 401, statusText: 'Unauthorized' });

    const error = (await rejection) as ApiError;
    expect(error.handled).toBe(true);
    expect(auth.me()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    const [commands, extras] = navigate.mock.calls[0] as [
      string[],
      { queryParams: Record<string, string> },
    ];
    expect(commands).toEqual(['/login']);
    expect(extras.queryParams).toHaveProperty('returnUrl');
  });

  it('does not redirect a 401 when nobody is signed in', async () => {
    const rejection = firstValueFrom(http.get('/api/habits')).catch((e: unknown) => e);

    httpMock
      .expectOne('/api/habits')
      .flush({ type: 'unauthenticated' }, { status: 401, statusText: 'Unauthorized' });

    expect(((await rejection) as ApiError).handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes to /consent on consent_required and marks the error handled', async () => {
    auth.setMe(me);
    const rejection = firstValueFrom(http.post('/api/habits', {})).catch((e: unknown) => e);

    httpMock
      .expectOne('/api/habits')
      .flush({ type: 'consent_required' }, { status: 403, statusText: 'Forbidden' });

    const error = (await rejection) as ApiError;
    expect(error.handled).toBe(true);
    expect(auth.me()).not.toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0] as [string[]])[0]).toEqual(['/consent']);
  });

  it('passes other failures through as unhandled ApiErrors', async () => {
    const rejection = firstValueFrom(http.get('/api/habits/9')).catch((e: unknown) => e);

    httpMock
      .expectOne('/api/habits/9')
      .flush({ type: 'not_found' }, { status: 404, statusText: 'Not Found' });

    const error = (await rejection) as ApiError;
    expect(error.status).toBe(404);
    expect(error.handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
