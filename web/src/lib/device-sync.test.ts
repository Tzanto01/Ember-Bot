import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';
import { AuthService } from './auth';
import { DeviceStore } from './device-store';
import { DeviceSync } from './device-sync';
import { Http } from './http';
import { Reminders } from './native/reminders';
import { TokenStore } from './native/token-store';
import { OfflineQueue } from './offline-queue';
import { setNavigator } from './navigation';
import { habit, me, memorySecureStore, mockFetch } from './test-support';
import { applyTheme } from './theme';

const native = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: async () => ({ remove: async () => undefined }) },
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: async (event: string, listener: (event: unknown) => void) => {
      native.listeners.set(event, listener);
      return { remove: async () => undefined };
    },
  },
}));

vi.mock('./native/widget', async (original) => ({
  ...(await original<typeof import('./native/widget')>()),
  capacitorWidget: async () => ({
    EmberWidget: {
      update: async () => undefined,
      clear: async () => undefined,
      addListener: async (event: string, listener: (event: unknown) => void) => {
        native.listeners.set(event, listener);
        return { remove: async () => undefined };
      },
    },
  }),
}));

describe('DeviceSync', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rebuilds the reminders in the new time zone as soon as me holds it', () => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    mockFetch();
    const http = new Http({ native: true, apiBase: '' });
    const device = new DeviceStore();
    const queue = new OfflineQueue(device);
    const api = new ApiClient(http, queue);
    const reminders = new Reminders(api, device);
    const rebuild = vi.spyOn(reminders, 'rebuild').mockResolvedValue();
    const tokens = new TokenStore(http, memorySecureStore().store);
    const auth = new AuthService(api, queue, null, { tokens, reminders });
    new DeviceSync(auth, api, queue, reminders);
    auth.setMe(me);
    rebuild.mockClear();

    auth.setMe({ ...me, graceDaysPerWeek: 2 });
    expect(rebuild).not.toHaveBeenCalled();

    auth.setMe({ ...me, timezone: 'Asia/Tokyo' });
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledWith('u1', 'Asia/Tokyo');

    rebuild.mockClear();
    applyTheme('marigold');
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  describe('automatic time zone', () => {
    function setup(timeZone = 'America/Halifax') {
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
      const fetch = mockFetch();
      const http = new Http({ native: false, apiBase: '' });
      const queue = new OfflineQueue(new DeviceStore());
      const api = new ApiClient(http, queue);
      const auth = new AuthService(api, queue, null, null);
      new DeviceSync(auth, api, queue, null);
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        timeZone,
      } as Intl.ResolvedDateTimeFormatOptions);
      return { fetch, auth };
    }

    afterEach(() => {
      vi.restoreAllMocks();
      localStorage.clear();
    });

    const patches = (fetch: ReturnType<typeof mockFetch>) => fetch.all.filter((call) => call.method === 'PATCH');

    it("sends the device's zone once when the account's zone was never set, and keeps the answer", async () => {
      const { fetch, auth } = setup();
      const fresh = { ...me, timezone: 'UTC', timezoneSet: false };
      auth.setMe(fresh);

      const patch = await fetch.next('PATCH', '/api/me');
      expect(patch.body).toEqual({ timezone: 'America/Halifax' });
      patch.respond(200, { ...fresh, timezone: 'America/Halifax', timezoneSet: true });
      await vi.waitFor(() => expect(auth.me.get()?.timezone).toBe('America/Halifax'));

      auth.setMe({ ...fresh, graceDaysPerWeek: 2 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch.all.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    });

    it('never changes a zone the user picked', async () => {
      const { fetch, auth } = setup();
      auth.setMe({ ...me, timezoneSet: true });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch.all.filter((call) => call.method === 'PATCH')).toHaveLength(0);
    });

    it('claims only once per user on this device, so a UTC the user saved later is kept', async () => {
      const first = setup();
      first.auth.setMe({ ...me, timezone: 'UTC', timezoneSet: false });
      (await first.fetch.next('PATCH', '/api/me')).respond(200, { ...me, timezone: 'America/Halifax' });
      await vi.waitFor(() => expect(first.auth.me.get()?.timezone).toBe('America/Halifax'));
      vi.unstubAllGlobals();
      vi.restoreAllMocks();

      const next = setup();
      next.auth.setMe({ ...me, timezone: 'UTC', timezoneSet: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(patches(next.fetch)).toHaveLength(0);
    });

    it.each(['UTC', 'Etc/UTC'])('does not claim when the device reports %s', async (zone) => {
      const { fetch, auth } = setup(zone);
      auth.setMe({ ...me, timezone: 'UTC', timezoneSet: false });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(patches(fetch)).toHaveLength(0);
    });
  });

  describe('check-in from a reminder or the widget', () => {
    const today = { userId: 'u1', habitId: 1, date: '2026-11-01' };
    const twice = { ...habit, timesPerDay: 2, today: { ...habit.today, count: 1, state: 'partial' as const } };

    async function setup(issued = true) {
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
      native.listeners.clear();
      const fetch = mockFetch();
      const http = new Http({ native: true, apiBase: '' });
      const device = new DeviceStore();
      const queue = new OfflineQueue(device);
      const api = new ApiClient(http, queue);
      const reminders = new Reminders(api, device);
      const rebuild = vi.spyOn(reminders, 'rebuild').mockResolvedValue();
      vi.spyOn(reminders, 'wasIssued').mockImplementation((id) => issued && id === 1);
      const auth = new AuthService(api, queue, null, { tokens: new TokenStore(http, memorySecureStore().store), reminders });
      const sync = new DeviceSync(auth, api, queue, reminders);
      auth.setMe(me);
      const paths: string[] = [];
      setNavigator((path) => paths.push(path));
      sync.start();
      await vi.waitFor(() => expect(native.listeners.has('widgetTap')).toBe(true));
      return { fetch, sync, paths, device, auth, rebuild };
    }

    afterEach(() => setNavigator(null));

    const done = (extra: unknown) =>
      native.listeners.get('localNotificationActionPerformed')?.({ actionId: 'done', notification: { id: 1, extra } });

    it('adds one to the habit through PUT { count }, opens Today and confirms', async () => {
      const { fetch, sync, paths } = await setup();

      done(today);
      (await fetch.next('GET', '/api/habits')).respond(200, [twice]);
      (await fetch.next('GET', '/api/routines')).respond(200, []);
      const put = await fetch.next('PUT', '/api/habits/1/days/2026-11-01');
      expect(put.body).toEqual({ count: 2 });
      put.respond(200, { ...twice, today: { ...twice.today, count: 2, state: 'done' } });

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
      expect(sync.nativeCheckIn.get()).toEqual({ name: 'Walk' });
    });

    it('offline, finds the habit in the cache and queues the absolute count', async () => {
      const { fetch, sync, paths, device } = await setup();
      await device.saveHabits({ userId: 'u1', timeZone: 'Europe/Berlin', habits: [twice] });

      done(today);
      (await fetch.next('GET', '/api/habits')).fail();
      (await fetch.next('PUT', '/api/habits/1/days/2026-11-01')).fail();

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
      expect(await device.edits('u1')).toMatchObject([{ habitId: 1, date: '2026-11-01', count: 2 }]);
      expect(sync.nativeCheckIn.get()).toEqual({ name: 'Walk' });
    });

    it('only opens Today for a "Done" this app never issued (forged by another app)', async () => {
      const { fetch, sync, paths } = await setup(false);

      done(today);

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
      expect(fetch.all.filter((call) => call.method === 'PUT')).toEqual([]);
      expect(sync.nativeCheckIn.get()).toBeNull();
    });

    it('forgets the confirmation and the dropped count when the user changes', async () => {
      const { sync, auth, rebuild } = await setup();
      sync.nativeCheckIn.set({ name: 'Walk' });
      sync.dropped.set(2);

      auth.setMe({ ...me, id: 'u2' });
      await vi.waitFor(() => expect(rebuild).toHaveBeenCalledWith('u2', me.timezone));

      expect(sync.nativeCheckIn.get()).toBeNull();
      expect(sync.dropped.get()).toBe(0);
    });

    it('checks in a widget row the same way', async () => {
      const { fetch, paths } = await setup();

      native.listeners.get('widgetTap')?.(today);
      (await fetch.next('GET', '/api/habits')).respond(200, [twice]);
      (await fetch.next('GET', '/api/routines')).respond(200, []);
      (await fetch.next('PUT', '/api/habits/1/days/2026-11-01')).respond(200, twice);

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
    });

    const send = (source: 'reminder' | 'widget', extra: unknown) =>
      source === 'reminder' ? done(extra) : native.listeners.get('widgetTap')?.(extra);

    it.each([
      ['another user', { ...today, userId: 'u2' }],
      ['a malformed date', { ...today, date: '2026-13-01' }],
      ['a non-integer habit id', { ...today, habitId: '1' }],
      ['a routine reminder', { userId: 'u1', routineId: 1, date: '2026-11-01' }],
    ])('only opens Today for %s, writing nothing', async (_, extra) => {
      for (const source of ['reminder', 'widget'] as const) {
        const { fetch, sync, paths } = await setup();
        send(source, extra);

        await vi.waitFor(() => expect(paths).toEqual(['/today']));
        expect(fetch.all.filter((call) => call.method === 'PUT')).toEqual([]);
        expect(sync.nativeCheckIn.get()).toBeNull();
        vi.unstubAllGlobals();
      }
    });

    it('only opens Today for a habit the app does not know', async () => {
      const { fetch, sync, paths } = await setup();

      done({ ...today, habitId: 99 });
      (await fetch.next('GET', '/api/habits')).respond(200, [twice]);
      (await fetch.next('GET', '/api/routines')).respond(200, []);

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
      expect(fetch.all.filter((call) => call.method === 'PUT')).toEqual([]);
      expect(sync.nativeCheckIn.get()).toBeNull();
    });

    it('treats a plain tap on a reminder as opening Today', async () => {
      const { fetch, paths } = await setup();

      native.listeners.get('localNotificationActionPerformed')?.({
        actionId: 'tap',
        notification: { id: 1, extra: today },
      });

      await vi.waitFor(() => expect(paths).toEqual(['/today']));
      expect(fetch.all.filter((call) => call.method !== 'GET')).toEqual([]);
    });
  });
});
