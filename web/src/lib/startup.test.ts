import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';
import { type CachedHabits, DeviceStore } from './device-store';
import { Http } from './http';
import type { Me } from './models';
import { OfflineQueue } from './offline-queue';
import { auth, deviceStore, http } from './services';
import { habitsCache, startApp } from './startup';
import { habit, me, mockFetch } from './test-support';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => undefined }));

function fakeStore(entry: CachedHabits | null) {
  return {
    habits: vi.fn(async () => entry),
    saveHabits: vi.fn(async () => undefined),
    deleteHabits: vi.fn(async () => undefined),
    edits: vi.fn(async () => []),
  };
}

describe('habitsCache', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the signed-in user's habit list and serves it offline while its day is still today", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    const store = fakeStore({ userId: me.id, timeZone: me.timezone, habits: [habit] });
    const cache = habitsCache(store, () => me);

    cache.save('/api/habits', [habit]);
    cache.save('/api/routines', []);
    expect(store.saveHabits).toHaveBeenCalledTimes(1);
    expect(store.saveHabits).toHaveBeenCalledWith({ userId: me.id, timeZone: me.timezone, habits: [habit] });
    expect(await cache.load('/api/habits')).toEqual([habit]);
    expect(await cache.load('/api/routines')).toBeUndefined();
  });

  it('serves nothing from another day or without a signed-in user', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] });
    const store = fakeStore({ userId: me.id, timeZone: me.timezone, habits: [habit] });

    expect(await habitsCache(store, () => me).load('/api/habits')).toBeUndefined();
    expect(await habitsCache(store, () => null).load('/api/habits')).toBeUndefined();
  });

  it('deletes a save that lands after the user changed', async () => {
    let user: Me | null = me;
    let finish = () => undefined as void;
    const store = fakeStore(null);
    store.saveHabits.mockImplementation(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))));
    const cache = habitsCache(store, () => user);

    cache.save('/api/habits', [habit]);
    user = null;
    finish();

    await vi.waitFor(() => expect(store.deleteHabits).toHaveBeenCalledWith(me.id));
  });

  it('keeps an offline check-in when the habit list is loaded again while offline', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    const fetch = mockFetch();
    const device = new DeviceStore();
    const queue = new OfflineQueue(device);
    queue.userId.set(me.id);
    const client = new Http({ native: false, apiBase: '' });
    client.offlineCache = habitsCache(device, () => me);
    const api = new ApiClient(client, queue);

    const online = api.listHabits();
    (await fetch.next('GET', '/api/habits')).respond(200, [habit]);
    await online;
    await vi.waitFor(async () => expect(await device.habits(me.id)).not.toBeNull());
    const checkIn = api.setDay(habit.id, habit.today.date, true);
    (await fetch.next('PUT', `/api/habits/${habit.id}/days/${habit.today.date}`)).fail();
    await checkIn;
    const refetch = api.listHabits();
    (await fetch.next('GET', '/api/habits')).fail();

    expect((await refetch)[0].today.state).toBe('done');
  });
});

describe('startApp on the web', () => {
  beforeAll(async () => {
    localStorage.clear();
    mockFetch();
    await startApp();
  });

  afterEach(() => {
    auth.clearSession();
    localStorage.clear();
    http.clearOfflineData();
  });

  it('keeps me on the device only for a user who chose to stay signed in', () => {
    auth.setMe(me);
    expect(localStorage.getItem('ember.offlineMe')).toBeNull();

    auth.staySignedIn.set(me.id);
    expect(JSON.parse(localStorage.getItem('ember.offlineMe') ?? 'null')).toEqual(me);
  });

  it("deletes the user's kept habit list and me when the session ends", async () => {
    auth.staySignedIn.set(me.id);
    auth.setMe(me);
    await deviceStore.saveHabits({ userId: me.id, timeZone: me.timezone, habits: [habit] });

    auth.clearSession();

    await vi.waitFor(async () => expect(await deviceStore.habits(me.id)).toBeNull());
    expect(localStorage.getItem('ember.offlineMe')).toBeNull();
  });

  it('drops the offline note once the browser is back online or the user changes', () => {
    http.offlineData.set(true);
    window.dispatchEvent(new Event('online'));
    expect(http.offlineData.get()).toBe(false);

    http.offlineData.set(true);
    auth.setMe(me);
    expect(http.offlineData.get()).toBe(false);
  });
});

describe('activateUpdate', () => {
  afterEach(() => vi.useRealTimers());

  it('reloads once when the new worker takes control', async () => {
    const target = new EventTarget();
    vi.stubGlobal('navigator', { serviceWorker: target });
    const reload = vi.fn();
    const { activateUpdate } = await import('./startup');

    await activateUpdate(async () => void target.dispatchEvent(new Event('controllerchange')), reload);
    target.dispatchEvent(new Event('controllerchange'));

    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('still reloads when this page never gets a controllerchange', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { serviceWorker: new EventTarget() });
    const reload = vi.fn();
    const { activateUpdate } = await import('./startup');

    await activateUpdate(async () => undefined, reload);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);

    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
