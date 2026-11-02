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
import { PushService } from './push';
import { type FetchMock, me, memorySecureStore, mockFetch } from './test-support';

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

    it('still loads me when the antiforgery refresh fails', async () => {
      const auth = setup();
      const done = auth.login('a@example.test', 'pw', true);

      (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(200);
      (await mock.next('GET', '/api/auth/antiforgery')).respond(500);
      (await mock.next('GET', '/api/me')).respond(200, me);

      await expect(done).resolves.toEqual(me);
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
});
