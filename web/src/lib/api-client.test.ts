import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';
import { DeviceStore } from './device-store';
import { Http } from './http';
import { OfflineQueue } from './offline-queue';
import { type FetchMock, habit, me, mockFetch } from './test-support';

const today = '2026-11-01';

describe('ApiClient offline day edits', () => {
  let api: ApiClient;
  let mock: FetchMock;
  let queue: OfflineQueue;
  let device: DeviceStore;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    mock = mockFetch();
    device = new DeviceStore();
    queue = new OfflineQueue(device);
    api = new ApiClient(new Http({ native: false, apiBase: '' }), queue);
    queue.userId.set('user-a');
  });

  afterEach(() => vi.unstubAllGlobals());

  async function remember(via: 'getHabit' | 'listHabits') {
    const loaded = via === 'getHabit' ? api.getHabit(1) : api.listHabits();
    (await mock.next('GET', via === 'getHabit' ? '/api/habits/1' : '/api/habits')).respond(
      200,
      via === 'getHabit' ? habit : [habit],
    );
    await loaded;
  }

  it.each(['getHabit', 'listHabits'] as const)(
    'answers a check-in lost to the network optimistically and queues it after %s',
    async (via) => {
      await remember(via);

      const result = api.setDay(1, today, true);
      (await mock.next('PUT', `/api/habits/1/days/${today}`)).fail();

      expect((await result).today).toEqual({ date: today, state: 'done', completed: true, count: 1 });
      expect(await device.edits('user-a')).toMatchObject([{ habitId: 1, date: today, completed: true }]);
      expect(queue.pending.get()).toBe(1);
    },
  );

  it('keeps a rest day resting when a check-in on it is cleared offline', async () => {
    const loaded = api.getHabit(1);
    (await mock.next('GET', '/api/habits/1')).respond(200, {
      ...habit,
      today: { date: today, state: 'offday', completed: null, count: 0 },
    });
    await loaded;

    const result = api.setDayCount(1, today, 0);
    (await mock.next('PUT', `/api/habits/1/days/${today}`)).fail();

    expect((await result).today.state).toBe('offday');
  });

  it('answers a clear lost to the network as a pending day and queues it', async () => {
    await remember('getHabit');

    const result = api.clearDay(1, today);
    (await mock.next('DELETE', `/api/habits/1/days/${today}`)).fail();

    expect((await result).today).toEqual({ date: today, state: 'pending', completed: null, count: 0 });
    expect(await device.edits('user-a')).toMatchObject([{ habitId: 1, completed: null }]);
  });

  it('queues a check-in answered by a 504 without a problem body (the service worker offline answer)', async () => {
    await remember('getHabit');

    const result = api.setDay(1, today, true);
    (await mock.next('PUT', `/api/habits/1/days/${today}`)).respond(504);

    expect((await result).today.state).toBe('done');
    expect(await device.edits('user-a')).toMatchObject([{ habitId: 1, completed: true }]);
  });

  it('rejects a 504 that carries a problem body and queues nothing', async () => {
    await remember('getHabit');

    const rejection = api.setDay(1, today, true).catch((e: unknown) => e);
    (await mock.next('PUT', `/api/habits/1/days/${today}`)).respond(504, { type: 'internal' });

    expect(await rejection).toMatchObject({ status: 504 });
    expect(await device.edits('user-a')).toEqual([]);
  });

  it('rejects a server error and queues nothing', async () => {
    await remember('getHabit');

    const rejection = api.setDay(1, today, true).catch((e: unknown) => e);
    (await mock.next('PUT', `/api/habits/1/days/${today}`)).respond(500);

    expect(await rejection).toMatchObject({ status: 500 });
    expect(await device.edits('user-a')).toEqual([]);
  });

  it('rejects a network failure for a habit it never saw and queues nothing', async () => {
    const rejection = api.setDay(9, today, true).catch((e: unknown) => e);
    (await mock.next('PUT', `/api/habits/9/days/${today}`)).fail();

    expect(await rejection).toMatchObject({ status: 0 });
    expect(await device.edits('user-a')).toEqual([]);
  });

  it('queues a new edit behind still-queued ones instead of sending it ahead of them', async () => {
    await remember('getHabit');
    await queue.add({ habitId: 1, date: '2026-10-31', completed: true });

    const result = await api.clearDay(1, today);

    expect(result.today).toEqual({ date: today, state: 'pending', completed: null, count: 0 });
    expect(mock.all.filter((c) => c.method !== 'GET')).toEqual([]);
    expect((await device.edits('user-a')).map((e) => e.date)).toEqual(['2026-10-31', today]);
  });
});

describe('ApiClient export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads the export as a blob named by Content-Disposition', async () => {
    const mock = mockFetch();
    const api = new ApiClient(
      new Http({ native: false, apiBase: '' }),
      new OfflineQueue(new DeviceStore()),
    );

    const file = api.exportData('csv');
    (await mock.next('GET', '/api/me/export?format=csv')).respond(200, 'a,b', {
      'Content-Disposition': `attachment; filename="ember-export-2026-11-01.csv"`,
    });

    const { blob, fileName } = await file;
    expect(fileName).toBe('ember-export-2026-11-01.csv');
    expect(await blob.text()).toBe('"a,b"');
  });
});

describe('ApiClient me', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats a me without the journal field (an API before v1.7) as a plain journal', async () => {
    const mock = mockFetch();
    const api = new ApiClient(new Http({ native: false, apiBase: '' }), new OfflineQueue(new DeviceStore()));
    const { journal: _journal, ...older } = me;

    const loaded = api.getMe();
    (await mock.next('GET', '/api/me')).respond(200, older);

    expect((await loaded).journal).toEqual({ encrypted: false, turningOff: false, plaintextLeft: 0, encryptedLeft: 0 });
  });
});
