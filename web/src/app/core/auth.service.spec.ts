import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { Me } from './models';

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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('AuthService', () => {
  let httpMock: HttpTestingController;

  function setup(swPush: unknown) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SwPush, useValue: swPush },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    return TestBed.inject(AuthService);
  }

  const next = async (method: string, urlWithParams: string): Promise<TestRequest> => {
    await tick();
    return httpMock.expectOne((r) => r.method === method && r.urlWithParams === urlWithParams);
  };

  afterEach(() => httpMock.verify());

  describe('login', () => {
    it.each([
      [false, '/api/auth/login?useSessionCookies=true'],
      [true, '/api/auth/login?useCookies=true'],
    ])(
      'with staySignedIn=%s posts to %s, then refreshes antiforgery, then loads me',
      async (stay, loginUrl) => {
        const auth = setup(null);
        const done = auth.login('a@example.test', 'pw', stay);

        const login = await next('POST', loginUrl);
        expect(login.request.body).toEqual({ email: 'a@example.test', password: 'pw' });
        login.flush(null);

        httpMock.expectNone('/api/me');
        (await next('GET', '/api/auth/antiforgery')).flush(null);

        httpMock.expectNone('/api/me');
        (await next('GET', '/api/me')).flush(me);

        await expect(done).resolves.toEqual(me);
        expect(auth.signedIn()).toBe(true);
      },
    );

    it('still loads me when the antiforgery refresh fails', async () => {
      const auth = setup(null);
      const done = auth.login('a@example.test', 'pw', true);

      (await next('POST', '/api/auth/login?useCookies=true')).flush(null);
      (await next('GET', '/api/auth/antiforgery')).flush(null, {
        status: 500,
        statusText: 'Server Error',
      });
      (await next('GET', '/api/me')).flush(me);

      await expect(done).resolves.toEqual(me);
    });
  });

  describe('logout', () => {
    it('removes the push subscription before signing out, then refreshes antiforgery and clears the session', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(undefined);
      const endpoint = 'https://push.example.test/abc?x=1&y=2';
      const auth = setup({
        isEnabled: true,
        subscription: new BehaviorSubject({ endpoint, unsubscribe }),
      });
      auth.setMe(me);
      const done = auth.logout();

      await tick();
      const removal = httpMock.expectOne(
        (r) =>
          r.method === 'DELETE' &&
          r.url === '/api/me/push-subscriptions' &&
          r.params.get('endpoint') === endpoint,
      );
      httpMock.expectNone('/api/auth/logout');
      expect(unsubscribe).not.toHaveBeenCalled();
      removal.flush(null);

      (await next('POST', '/api/auth/logout')).flush(null);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      (await next('GET', '/api/auth/antiforgery')).flush(null);

      await done;
      expect(auth.me()).toBeNull();
      expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/login');
    });

    it('signs out without touching push endpoints when there is no subscription', async () => {
      const auth = setup({ isEnabled: true, subscription: new BehaviorSubject(null) });
      auth.setMe(me);
      const done = auth.logout();

      (await next('POST', '/api/auth/logout')).flush(null);
      (await next('GET', '/api/auth/antiforgery')).flush(null);

      await done;
      httpMock.expectNone((r) => r.url.includes('push-subscriptions'));
      expect(auth.me()).toBeNull();
    });

    it('still signs out locally when the server call fails', async () => {
      const auth = setup(null);
      auth.setMe(me);
      const done = auth.logout();

      (await next('POST', '/api/auth/logout')).flush(null, {
        status: 500,
        statusText: 'Server Error',
      });
      (await next('GET', '/api/auth/antiforgery')).flush(null);

      await expect(done).resolves.toBeUndefined();
      expect(auth.me()).toBeNull();
    });
  });
});
