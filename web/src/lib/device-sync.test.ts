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
import { me, memorySecureStore, mockFetch } from './test-support';
import { applyTheme } from './theme';

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
});
