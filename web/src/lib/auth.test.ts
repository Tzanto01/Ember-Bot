import 'fake-indexeddb/auto';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from './api-client';
import { AuthService } from './auth';
import { DeviceStore } from './device-store';
import { Http } from './http';
import { Reminders } from './native/reminders';
import { TokenStore } from './native/token-store';
import { setNavigator } from './navigation';
import { OfflineQueue } from './offline-queue';
import { requiresTwoFactor } from './problem';
import { PushService } from './push';
import { type FetchMock, me, memorySecureStore, mockFetch } from './test-support';
import { chooseTheme } from './theme';

describe('AuthService', () => {
  let mock: FetchMock;
  let navigate: Mock<(path: string) => void>;
  let queue: OfflineQueue;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    mock = mockFetch();
    navigate = vi.fn<(path: string) => void>();
    setNavigator(navigate);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigator(null);
  });

  /** Web build; `subscription` is what the service worker's push manager holds (null: none). */
  function setup(subscription: PushSubscription | null = null) {
    const http = new Http({ native: false, apiBase: '' });
    queue = new OfflineQueue(new DeviceStore());
    vi.spyOn(queue, 'clear').mockResolvedValue();
    const api = new ApiClient(http, queue);
    const registration = {
      pushManager: { getSubscription: async () => subscription },
    } as unknown as ServiceWorkerRegistration;
    const auth = new AuthService(api, queue, new PushService(api, async () => registration), null);
    http.session = auth;
    return auth;
  }

  describe('login', () => {
    it.each([
      [false, '/api/auth/login?useSessionCookies=true'],
      [true, '/api/auth/login?useCookies=true'],
    ])(
      'with staySignedIn=%s posts to %s, then refreshes antiforgery, then loads me',
      async (stay, loginUrl) => {
        const auth = setup();
        const done = auth.login('a@example.test', 'pw', stay);

        const login = await mock.next('POST', loginUrl);
        expect(login.body).toEqual({ email: 'a@example.test', password: 'pw' });
        login.respond(200);

        const antiforgery = await mock.next('GET', '/api/auth/antiforgery');
        expect(mock.all.some((c) => c.url === '/api/me')).toBe(false);
        antiforgery.respond(204);

        (await mock.next('GET', '/api/me')).respond(200, me);

        await expect(done).resolves.toEqual(me);
        expect(auth.signedIn()).toBe(true);
      },
    );

    it('signs the browser in with the emailed code and a cookie that stays, then refreshes antiforgery and loads me', async () => {
      const auth = setup();
      const done = auth.confirmEmailCode({ email: 'new@example.test', code: '123456' });

      const confirm = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
      expect(confirm.body).toEqual({ email: 'new@example.test', code: '123456' });
      confirm.respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      (await mock.next('GET', '/api/me')).respond(200, me);

      await expect(done).resolves.toEqual(me);
      expect(auth.staySignedIn.get()).toBe(me.id);
    });

    it('in the native build signs in with the emailed code through bearer tokens, without cookie flags', async () => {
      const http = new Http({ native: true, apiBase: '' });
      const device = new DeviceStore();
      queue = new OfflineQueue(device);
      const api = new ApiClient(http, queue);
      const memory = memorySecureStore();
      const tokens = new TokenStore(http, memory.store);
      http.bearer = tokens;
      const reminders = new Reminders(api, device, async () => ({
        LocalNotifications: {} as unknown as LocalNotificationsPlugin,
      }));
      const auth = new AuthService(api, queue, null, { tokens, reminders });
      http.session = auth;
      const done = auth.confirmEmailCode({ userId: 'u1', code: '123456' });

      const confirm = await mock.next('POST', '/api/auth/confirm-email-code');
      expect(confirm.body).toEqual({ userId: 'u1', code: '123456' });
      confirm.respond(200, { tokenType: 'Bearer', accessToken: 'access-1', expiresIn: 900, refreshToken: 'refresh-1' });
      const meCall = await mock.next('GET', '/api/me');
      expect(meCall.headers.get('Authorization')).toBe('Bearer access-1');
      meCall.respond(200, me);

      await expect(done).resolves.toEqual(me);
      expect(memory.secure.get('ember.refreshToken')).toBe('refresh-1');
      expect(mock.all.some((c) => c.url.includes('antiforgery'))).toBe(false);
    });

    it('sends the authenticator code or a recovery code with the login after RequiresTwoFactor', async () => {
      const auth = setup();
      const done = auth.login('a@example.test', 'pw', true, { code: '123456' });
      const login = await mock.next('POST', '/api/auth/login?useCookies=true');
      expect(login.body).toEqual({
        email: 'a@example.test',
        password: 'pw',
        twoFactorCode: '123456',
      });
      login.respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      (await mock.next('GET', '/api/me')).respond(200, me);
      await done;

      const again = auth.login('a@example.test', 'pw', false, { recoveryCode: 'ABCD-EFGH' });
      const second = await mock.next('POST', '/api/auth/login?useSessionCookies=true');
      expect(second.body).toEqual({
        email: 'a@example.test',
        password: 'pw',
        twoFactorRecoveryCode: 'ABCD-EFGH',
      });
      second.respond(401, { detail: 'RequiresTwoFactor' });
      await expect(again).rejects.toSatisfy(requiresTwoFactor);
    });

    it('finishes a Discord sign-in with the second factor, then refreshes antiforgery and loads me', async () => {
      const auth = setup();
      const done = auth.completeDiscordTwoFactor({ code: '654321' });

      const post = await mock.next('POST', '/api/auth/discord/2fa');
      expect(post.body).toEqual({ code: '654321' });
      post.respond(204);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      (await mock.next('GET', '/api/me')).respond(200, me);

      await expect(done).resolves.toEqual(me);
    });

    it('still loads me when the antiforgery refresh fails', async () => {
      const auth = setup();
      const done = auth.login('a@example.test', 'pw', true);

      (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(500);
      (await mock.next('GET', '/api/me')).respond(200, me);

      await expect(done).resolves.toEqual(me);
    });
  });

  describe('stay signed in', () => {
    async function signIn(auth: AuthService, stay: boolean) {
      const done = auth.login('a@example.test', 'pw', stay);
      (await mock.next('POST', `/api/auth/login?${stay ? 'useCookies' : 'useSessionCookies'}=true`)).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      (await mock.next('GET', '/api/me')).respond(200, me);
      await done;
    }

    it('records only a "stay signed in" password sign-in, keeps it across starts and forgets it with the session', async () => {
      localStorage.clear();
      const auth = setup();

      await signIn(auth, true);
      expect(auth.staySignedIn.get()).toBe(me.id);
      expect(setup().staySignedIn.get()).toBe(me.id);

      auth.clearSession();
      expect(auth.staySignedIn.get()).toBeNull();
      expect(setup().staySignedIn.get()).toBeNull();

      await signIn(auth, true);
      await signIn(auth, false);
      expect(auth.staySignedIn.get()).toBeNull();
      expect(setup().staySignedIn.get()).toBeNull();
    });
  });

  describe('loadMe', () => {
    it('leaves me null when the response arrives after the session was cleared', async () => {
      const auth = setup();

      const loading = auth.loadMe(true);
      const call = await mock.next('GET', '/api/me');
      auth.clearSession();
      call.respond(200, me);

      await expect(loading).resolves.toBeNull();
      expect(auth.me.get()).toBeNull();
      expect(auth.signedIn()).toBe(false);
    });
  });

  describe('journal key', () => {
    function withJournal() {
      const auth = setup();
      const journal = {
        forget: vi.fn(async () => undefined),
        restore: vi.fn(async () => undefined),
      };
      auth.journal = journal;
      return { auth, journal };
    }

    it('restores the journal key after me loads', async () => {
      const { auth, journal } = withJournal();
      const loading = auth.loadMe(true);
      expect(journal.restore).not.toHaveBeenCalled();
      (await mock.next('GET', '/api/me')).respond(200, me);
      await loading;

      expect(journal.restore).toHaveBeenCalledOnce();
    });

    it('forgets it when the session ends, on account delete (wipeDevice) and on logout', async () => {
      const { auth, journal } = withJournal();
      auth.setMe(me);
      auth.clearSession();
      expect(journal.forget).toHaveBeenCalledTimes(1);

      auth.setMe(me);
      await auth.wipeDevice();
      expect(journal.forget).toHaveBeenCalledTimes(2);

      auth.setMe(me);
      const out = auth.logout();
      (await mock.next('POST', '/api/auth/logout')).respond(204);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      await expect(out).resolves.toBe(true);
      expect(journal.forget).toHaveBeenCalledTimes(4);
    });
  });

  describe('clearSession', () => {
    it('in the native build cancels the reminders but keeps the queued check-ins', async () => {
      const http = new Http({ native: true, apiBase: '' });
      const device = new DeviceStore();
      queue = new OfflineQueue(device);
      vi.spyOn(queue, 'clear').mockResolvedValue();
      const api = new ApiClient(http, queue);
      const tokens = new TokenStore(http, memorySecureStore().store);
      const cancel = vi.fn(async () => undefined);
      const plugin = {
        getPending: async () => ({ notifications: [{ id: 1 }] }),
        cancel,
        removeAllDeliveredNotifications: async () => undefined,
      } as unknown as LocalNotificationsPlugin;
      const reminders = new Reminders(api, device, async () => ({ LocalNotifications: plugin }));
      const auth = new AuthService(api, queue, null, { tokens, reminders });
      auth.setMe(me);

      auth.clearSession();

      await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }] }));
      expect(queue.clear).not.toHaveBeenCalled();
      expect(auth.signedIn()).toBe(false);
    });
  });

  describe('logout', () => {
    it('removes the push subscription before signing out, then refreshes antiforgery and clears the session', async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      const endpoint = 'https://push.example.test/abc?x=1&y=2';
      const auth = setup({ endpoint, unsubscribe } as unknown as PushSubscription);
      auth.setMe(me);
      const done = auth.logout();

      const removal = await mock.next(
        'DELETE',
        `/api/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`,
      );
      expect(mock.all.some((c) => c.url === '/api/auth/logout')).toBe(false);
      expect(unsubscribe).not.toHaveBeenCalled();
      removal.respond(204);

      const logout = await mock.next('POST', '/api/auth/logout');
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      logout.respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);

      await done;
      expect(auth.me.get()).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/login');
    });

    it('keeps the session and reports failure when the server cannot end it, so the cookie never outlives a sign-out', async () => {
      const auth = setup(null);
      auth.setMe(me);
      const done = auth.logout();

      (await mock.next('POST', '/api/auth/logout')).respond(503);

      await expect(done).resolves.toBe(false);
      expect(auth.me.get()).toEqual(me);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('treats a 401 from logout as already signed out', async () => {
      const auth = setup(null);
      auth.setMe(me);
      const done = auth.logout();

      (await mock.next('POST', '/api/auth/logout')).respond(401);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);

      await expect(done).resolves.toBe(true);
      expect(auth.me.get()).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/login');
    });

    it('keeps the session and reports failure when sign out everywhere answers 401', async () => {
      const auth = setup(null);
      auth.setMe(me);
      const done = auth.logout(true);

      (await mock.next('POST', '/api/auth/logout-everywhere')).respond(401);

      await expect(done).resolves.toBe(false);
      expect(auth.me.get()).toEqual(me);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('forgets the address this device signed up with', async () => {
      const auth = setup(null);
      auth.setMe(me);
      localStorage.setItem('ember.signupEmail', JSON.stringify({ email: 'new@example.test', at: Date.now() }));
      const done = auth.logout();

      (await mock.next('POST', '/api/auth/logout')).respond(204);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);

      await expect(done).resolves.toBe(true);
      expect(localStorage.getItem('ember.signupEmail')).toBeNull();
    });

    it('signs out without touching push endpoints when there is no subscription', async () => {
      const auth = setup(null);
      auth.setMe(me);
      const done = auth.logout();

      (await mock.next('POST', '/api/auth/logout')).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);

      await done;
      expect(mock.all.some((c) => c.url.includes('push-subscriptions'))).toBe(false);
      expect(auth.me.get()).toBeNull();
    });

    it("wipes the user's queued edits and remembered phone channels from the device", async () => {
      const auth = setup();
      localStorage.setItem('ember.channelsBeforePhone.7', '["discord"]');
      localStorage.setItem('unrelated', 'kept');
      auth.setMe(me);
      const done = auth.logout();

      (await mock.next('POST', '/api/auth/logout')).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      await done;

      expect(queue.clear).toHaveBeenCalledWith('u1');
      expect(localStorage.getItem('ember.channelsBeforePhone.7')).toBeNull();
      expect(localStorage.getItem('unrelated')).toBe('kept');
      localStorage.removeItem('unrelated');
    });

    it('in the native build wipes reminders, then tokens, then the queue, then the remembered channels, without a request', async () => {
      const order: string[] = [];
      const http = new Http({ native: true, apiBase: '' });
      const device = new DeviceStore();
      queue = new OfflineQueue(device);
      const api = new ApiClient(http, queue);
      const memory = memorySecureStore();
      memory.secure.set('ember.refreshToken', 'refresh-1');
      const tokens = new TokenStore(http, {
        ...memory.store,
        remove: async (key) => {
          order.push('tokens');
          await memory.store.remove(key);
        },
      });
      const plugin = {
        getPending: async () => ({ notifications: [{ id: 1 }] }),
        cancel: async () => void order.push('reminders'),
        removeAllDeliveredNotifications: async () => undefined,
      } as unknown as LocalNotificationsPlugin;
      const reminders = new Reminders(api, device, async () => ({ LocalNotifications: plugin }));
      vi.spyOn(queue, 'clear').mockImplementation(async () => {
        order.push(
          localStorage.getItem('ember.channelsBeforePhone.7') ? 'queue' : 'queue after channels',
        );
      });
      localStorage.setItem('ember.channelsBeforePhone.7', '["discord"]');
      const auth = new AuthService(api, queue, null, { tokens, reminders });
      auth.setMe(me);

      await auth.logout();

      expect(order).toEqual(['reminders', 'tokens', 'queue']);
      expect(queue.clear).toHaveBeenCalledWith('u1');
      expect(memory.secure.size).toBe(0);
      expect(localStorage.getItem('ember.channelsBeforePhone.7')).toBeNull();
      expect(auth.me.get()).toBeNull();
      expect(mock.all).toEqual([]);
      expect(navigate).toHaveBeenCalledWith('/login');
    });
  });

  describe('account theme', () => {
    afterEach(() => {
      localStorage.clear();
      document.documentElement.removeAttribute('data-theme');
    });

    it('applies and stores the theme from /api/me when it differs from this device', async () => {
      localStorage.setItem('ember.theme', 'hearthlight');
      document.documentElement.dataset['theme'] = 'hearthlight';
      const auth = setup();
      const loaded = auth.loadMe();
      (await mock.next('GET', '/api/me')).respond(200, { ...me, theme: 'tidepool' });
      await loaded;

      expect(document.documentElement.dataset['theme']).toBe('tidepool');
      expect(localStorage.getItem('ember.theme')).toBe('tidepool');
    });

    it('leaves this device as it is when the account has no theme', async () => {
      localStorage.setItem('ember.theme', 'marigold');
      document.documentElement.dataset['theme'] = 'marigold';
      const auth = setup();
      const loaded = auth.loadMe();
      (await mock.next('GET', '/api/me')).respond(200, { ...me, theme: null });
      await loaded;

      expect(document.documentElement.dataset['theme']).toBe('marigold');
      expect(localStorage.getItem('ember.theme')).toBe('marigold');
    });

    it('keeps a pick whose save failed and sends it again instead of reverting to the account theme', async () => {
      localStorage.setItem('ember.accountTheme', 'tidepool');
      localStorage.setItem('ember.theme', 'marigold');
      document.documentElement.dataset['theme'] = 'marigold';
      const auth = setup();
      const loaded = auth.loadMe();
      (await mock.next('GET', '/api/me')).respond(200, { ...me, theme: 'tidepool' });
      await loaded;

      expect(document.documentElement.dataset['theme']).toBe('marigold');
      const patch = await mock.next('PATCH', '/api/me');
      expect(patch.body).toEqual({ theme: 'marigold' });
      patch.respond(200, { ...me, theme: 'marigold' });
      await vi.waitFor(() => expect(localStorage.getItem('ember.accountTheme')).toBe('marigold'));
      expect(auth.me.get()?.theme).toBe('marigold');
    });

    it('ignores the account theme from a load that started before the latest pick', async () => {
      const auth = setup();
      const loaded = auth.loadMe();
      const get = await mock.next('GET', '/api/me');
      chooseTheme('fieldnotes');
      get.respond(200, { ...me, theme: 'tidepool' });
      await loaded;

      expect(document.documentElement.dataset['theme']).toBe('fieldnotes');
      expect(localStorage.getItem('ember.theme')).toBe('fieldnotes');
    });

    it('shows the default theme again after sign-out, so the next account starts fresh', async () => {
      localStorage.setItem('ember.accountTheme', 'marigold');
      localStorage.setItem('ember.theme', 'marigold');
      document.documentElement.dataset['theme'] = 'marigold';
      const auth = setup(null);
      auth.setMe({ ...me, theme: 'marigold' });
      const done = auth.logout();
      (await mock.next('POST', '/api/auth/logout')).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
      await done;

      expect(document.documentElement.dataset['theme']).toBe('hearthlight');
      expect(localStorage.getItem('ember.theme')).toBeNull();
      expect(localStorage.getItem('ember.accountTheme')).toBeNull();
    });
  });
});
