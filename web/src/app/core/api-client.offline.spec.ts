import 'fake-indexeddb/auto';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { ApiClient } from './api-client';
import { DeviceStore } from './device-store';
import { Habit } from './models';
import { OfflineQueue } from './offline-queue';

const today = '2026-11-01';

const habit: Habit = {
  id: 1,
  name: 'Walk',
  frequency: 'daily',
  weeklyTarget: null,
  reminderTime: null,
  pausedFrom: null,
  pausedUntil: null,
  pausedToday: false,
  createdAt: '2026-01-01T00:00:00Z',
  startDate: '2026-01-01',
  today: { date: today, state: 'pending', completed: null },
  stats: { streak: 0, graceUsed: 0, bestStreak: 0, last7: 0, week: null },
};

describe('ApiClient offline day edits', () => {
  let api: ApiClient;
  let mock: HttpTestingController;
  let queue: OfflineQueue;
  let device: DeviceStore;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    mock = TestBed.inject(HttpTestingController);
    queue = TestBed.inject(OfflineQueue);
    device = TestBed.inject(DeviceStore);
    queue.userId.set('user-a');
  });

  afterEach(() => mock.verify());

  async function remember(via: 'getHabit' | 'listHabits') {
    const loaded = via === 'getHabit' ? api.getHabit(1) : api.listHabits();
    mock.expectOne(via === 'getHabit' ? '/api/habits/1' : '/api/habits').flush(via === 'getHabit' ? habit : [habit]);
    await loaded;
  }

  it.each(['getHabit', 'listHabits'] as const)(
    'answers a check-in lost to the network optimistically and queues it after %s',
    async (via) => {
      await remember(via);

      const result = api.setDay(1, today, true);
      await vi.waitFor(() => mock.expectOne({ method: 'PUT', url: `/api/habits/1/days/${today}` }).error(new ProgressEvent('error')));

      expect((await result).today).toEqual({ date: today, state: 'done', completed: true });
      expect(await device.edits('user-a')).toMatchObject([{ habitId: 1, date: today, completed: true }]);
      expect(queue.pending()).toBe(1);
    },
  );

  it('answers a clear lost to the network as a pending day and queues it', async () => {
    await remember('getHabit');

    const result = api.clearDay(1, today);
    await vi.waitFor(() => mock.expectOne({ method: 'DELETE', url: `/api/habits/1/days/${today}` }).error(new ProgressEvent('error')));

    expect((await result).today).toEqual({ date: today, state: 'pending', completed: null });
    expect(await device.edits('user-a')).toMatchObject([{ habitId: 1, completed: null }]);
  });

  it('rejects a server error and queues nothing', async () => {
    await remember('getHabit');

    const rejection = api.setDay(1, today, true).catch((e: unknown) => e);
    mock
      .expectOne({ method: 'PUT', url: `/api/habits/1/days/${today}` })
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(await rejection).toMatchObject({ status: 500 });
    expect(await device.edits('user-a')).toEqual([]);
  });

  it('rejects a network failure for a habit it never saw and queues nothing', async () => {
    const rejection = api.setDay(9, today, true).catch((e: unknown) => e);
    mock.expectOne(`/api/habits/9/days/${today}`).error(new ProgressEvent('error'));

    expect(await rejection).toMatchObject({ status: 0 });
    expect(await device.edits('user-a')).toEqual([]);
  });
});
