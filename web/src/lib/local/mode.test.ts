import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { AuthService } from '../auth';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import { OfflineQueue } from '../offline-queue';
import { type FetchMock, me, mockFetch } from '../test-support';
import { LocalBackend } from './backend';
import { LocalMode } from './mode';
import { LocalStore } from './store';

describe('LocalMode', () => {
  let mock: FetchMock;
  let store: LocalStore;
  let http: Http;
  let auth: AuthService;
  let mode: LocalMode;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    localStorage.clear();
    mock = mockFetch();
    store = new LocalStore();
    http = new Http({ native: false, apiBase: '' });
    const queue = new OfflineQueue(new DeviceStore());
    const api = new ApiClient(http, queue);
    auth = new AuthService(api, queue, null, null);
    http.session = auth;
    mode = new LocalMode(store, new LocalBackend(store, { native: false }), http, api, auth, { native: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts on the device: a fresh profile, the flag, and the local me, without any request', async () => {
    await mode.start();

    const data = await store.load();
    expect(data?.profile.graceDaysPerWeek).toBe(1);
    expect(auth.me.get()?.id).toBe(data?.profile.userId);
    expect(localStorage.getItem('ember.mode')).toBe('local');
    expect(mode.mode.get()).toBe('local');
    expect(mock.all).toHaveLength(0);
  });

  it('restores local mode at start, and notices when the browser cleared the data', async () => {
    localStorage.setItem('ember.mode', 'local');

    await mode.init();

    expect(mode.mode.get()).toBe('local');
    expect(mode.evicted.get()).toBe(true);
    expect(http.local).not.toBeNull();
    expect(await store.exists()).toBe(true);
  });

  it('keeps the device data while upgrading and returns to it on cancel', async () => {
    await mode.start();
    const userId = auth.me.get()?.id;

    const begin = mode.beginUpgrade();
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    await begin;

    expect(mode.mode.get()).toBe('upgrading');
    expect(http.local).toBeNull();
    expect(auth.me.get()).toBeNull();
    expect(localStorage.getItem('ember.mode')).toBe('upgrading');

    auth.setMe({ ...me, id: 'account-1' });
    const cancel = mode.cancelUpgrade();
    (await mock.next('POST', '/api/auth/logout')).respond(204);
    await cancel;

    expect(mode.mode.get()).toBe('local');
    expect(auth.me.get()?.id).toBe(userId);
  });

  it('wipes the device data and leaves local mode', async () => {
    await mode.start();

    const wipe = mode.wipe();
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    await wipe;

    expect(await store.exists()).toBe(false);
    expect(localStorage.getItem('ember.mode')).toBeNull();
    expect(http.local).toBeNull();
    expect(auth.me.get()).toBeNull();
    expect(mode.mode.get()).toBe('account');
  });
});
