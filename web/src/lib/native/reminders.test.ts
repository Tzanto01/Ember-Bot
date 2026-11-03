import 'fake-indexeddb/auto';
import type { LocalNotificationsPlugin, ScheduleOptions } from '@capacitor/local-notifications';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import type { Habit, Routine } from '../models';
import { OfflineQueue } from '../offline-queue';
import { type FetchMock, habit, mockFetch } from '../test-support';
import { applyTheme } from '../theme';
import { reminderNames } from './reminder-names';
import { doneActionType, Reminders, reminderBody } from './reminders';
import type { EmberWidgetPlugin } from './widget';

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
      registerActionTypes: async () => undefined,
      schedule,
    } as unknown as LocalNotificationsPlugin;
    const widget = {
      update: async () => undefined,
      clear: async () => undefined,
    } as unknown as EmberWidgetPlugin;
    const api = new ApiClient(new Http({ native: true, apiBase: '' }), new OfflineQueue(device));
    reminders = new Reminders(
      api,
      device,
      async () => ({ LocalNotifications: plugin }),
      async () => ({ EmberWidget: widget }),
    );
    await device.saveHabits({ userId: 'u1', timeZone: zone, habits: [reminded] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    reminderNames.set(false);
    localStorage.clear();
  });

  async function rebuildOnline(habits: Habit[], routines: unknown[] = []) {
    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, habits);
    (await mock.next('GET', '/api/routines')).respond(200, routines);
    await done;
    return schedule.mock.calls[0][0].notifications;
  }

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
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await done;

    expect(scheduledAt()[0]).toBe('2026-11-01T11:00:00.000Z');
    expect(await device.habits('u1')).toMatchObject({
      timeZone: 'Asia/Tokyo',
      habits: [{ name: 'Read' }],
    });
  });

  it("tints the reminder icon with the current theme's colour", async () => {
    applyTheme('tidepool');
    const notifications = await rebuildOnline([reminded]);

    expect(new Set(notifications.map((n) => n.iconColor))).toEqual(new Set(['#7DD5D8']));
  });

  it('names no habit and offers no action while "Show habit names" is off', async () => {
    const [first] = await rebuildOnline([reminded]);

    expect(first).toMatchObject({ title: 'Ember', body: reminderBody });
    expect(first.actionTypeId).toBeUndefined();
    expect(first.extra).toEqual({ userId: 'u1', habitId: 1, date: '2026-11-01' });
  });

  it('names the habit with a Done action, and the routine without one, while "Show habit names" is on', async () => {
    reminderNames.set(true);
    const routine = {
      id: 4,
      name: 'Evening',
      reminderTime: '19:00',
      reminderChannels: ['mobile'],
      habitIds: [2],
    };
    const notifications = await rebuildOnline([reminded, { ...reminded, id: 2, name: 'Read' }], [routine]);

    expect(notifications[0]).toMatchObject({
      title: 'Evening',
      body: reminderBody,
      extra: { userId: 'u1', routineId: 4, date: '2026-11-01' },
    });
    expect(notifications[0].actionTypeId).toBeUndefined();
    expect(notifications[1]).toMatchObject({
      title: 'Walk',
      actionTypeId: doneActionType,
      extra: { userId: 'u1', habitId: 1, date: '2026-11-01' },
    });
    expect(JSON.stringify(notifications)).not.toContain('Read');
  });

  it('remembers which "Done" notifications it issued, for that exact extra only', async () => {
    reminderNames.set(true);
    const [first] = await rebuildOnline([reminded]);
    const extra = { userId: 'u1', habitId: 1, date: '2026-11-01' };

    expect(reminders.wasIssued(first.id, extra)).toBe(true);
    expect(reminders.wasIssued(first.id, { ...extra, habitId: 2 })).toBe(false);
    expect(reminders.wasIssued(first.id + 100, extra)).toBe(false);

    reminderNames.set(false);
    await reminders.clearAll();
    expect(reminders.wasIssued(first.id, extra)).toBe(false);
  });

  it('keeps one record per issued "Done", dropping stale future ones, and still schedules when storage is full', async () => {
    reminderNames.set(true);
    const stale = { id: 99, userId: 'u1', habitId: 1, date: '2026-11-05' };
    localStorage.setItem('ember.reminderIssued', JSON.stringify([stale]));
    await rebuildOnline([reminded]);
    const once = localStorage.getItem('ember.reminderIssued');

    const again = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await again;

    expect(localStorage.getItem('ember.reminderIssued')).toBe(once);
    expect(JSON.parse(once ?? '[]')).toHaveLength(7);
    expect(reminders.wasIssued(99, stale)).toBe(false);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const full = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await full;
    vi.restoreAllMocks();

    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('keeps planning the cached routines when only the routine list fails', async () => {
    const routine: Routine = {
      id: 4,
      name: 'Evening',
      reminderTime: '19:00',
      reminderChannels: ['mobile'],
      habitIds: [1],
    };
    await device.saveHabits({ userId: 'u1', timeZone: zone, habits: [reminded], routines: [routine] });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(500);
    await done;

    expect(schedule.mock.calls[0][0].notifications[0].extra).toMatchObject({ routineId: 4 });
    expect((await device.habits('u1'))?.routines).toEqual([routine]);
  });

  it('issues no "Done" while names are off', async () => {
    const [first] = await rebuildOnline([reminded]);

    expect(reminders.wasIssued(first.id, first.extra)).toBe(false);
  });

  it('offline, plans the cached routines too', async () => {
    await device.saveHabits({
      userId: 'u1',
      timeZone: zone,
      habits: [reminded],
      routines: [{ id: 4, name: 'Evening', reminderTime: '19:00', reminderChannels: ['mobile'], habitIds: [1] }],
    });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).fail();
    await done;

    expect(schedule.mock.calls[0][0].notifications[0].extra).toEqual({
      userId: 'u1',
      routineId: 4,
      date: '2026-11-01',
    });
  });

  it('calls the native notifications plugin without awaiting the proxy itself', async () => {
    const native = new Reminders(
      new ApiClient(new Http({ native: true, apiBase: '' }), new OfflineQueue(device)),
      device,
    );

    expect(await native.exactAllowed()).toBe(true);
  });
});

vi.mock('@capacitor/local-notifications', async () => ({
  LocalNotifications: (await import('../test-support')).capacitorPlugin({
    checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
  }),
}));
