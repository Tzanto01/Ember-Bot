import 'fake-indexeddb/auto';
import type { LocalNotificationsPlugin, ScheduleOptions } from '@capacitor/local-notifications';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import type { Habit } from '../models';
import { OfflineQueue } from '../offline-queue';
import { type FetchMock, habit, mockFetch } from '../test-support';
import { Reminders } from './reminders';

const zone = 'Europe/Berlin';
const reminded: Habit = { ...habit, reminderTime: '20:00', reminderChannels: ['mobile'] };

describe('Reminders', () => {
  let mock: FetchMock;
  let device: DeviceStore;
  let reminders: Reminders;
  let schedule: Mock<(options: ScheduleOptions) => Promise<unknown>>;
  let getPending: Mock;

  beforeEach(async () => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    mock = mockFetch();
    device = new DeviceStore();
    schedule = vi.fn<(options: ScheduleOptions) => Promise<unknown>>(async () => ({}));
    getPending = vi.fn(async () => ({ notifications: [] }));
    const plugin = {
      createChannel: async () => undefined,
      getPending,
      cancel: async () => undefined,
      checkPermissions: async () => ({ display: 'granted' }),
      schedule,
    } as unknown as LocalNotificationsPlugin;
    const api = new ApiClient(new Http({ native: true, apiBase: '' }), new OfflineQueue(device));
    reminders = new Reminders(api, device, async () => plugin);
    await device.saveHabits({ userId: 'u1', timeZone: zone, habits: [reminded] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const scheduledAt = () =>
    schedule.mock.calls[0][0].notifications.map((n) => n.schedule?.at?.toISOString());

  it("offline, plans from the cached habits with the queued check-in applied, so today's reminder is cancelled", async () => {
    await device.addEdit('u1', { habitId: 1, date: '2026-11-01', completed: true });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).fail();
    await done;

    const at = scheduledAt();
    expect(at).toHaveLength(6);
    expect(at[0]).toBe('2026-11-02T19:00:00.000Z');
  });

  it('schedules nothing from the cache when the API answers 401', async () => {
    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(401);
    await done;

    expect(schedule).not.toHaveBeenCalled();
    expect(getPending).not.toHaveBeenCalled();
  });

  it('plans from the live habit list and caches it', async () => {
    const done = reminders.rebuild('u1', 'Asia/Tokyo');
    (await mock.next('GET', '/api/habits')).respond(200, [{ ...reminded, name: 'Read' }]);
    await done;

    expect(scheduledAt()[0]).toBe('2026-11-01T11:00:00.000Z');
    expect(await device.habits('u1')).toMatchObject({
      timeZone: 'Asia/Tokyo',
      habits: [{ name: 'Read' }],
    });
  });
});
