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
  });
});
