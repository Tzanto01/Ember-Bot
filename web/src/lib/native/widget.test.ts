import 'fake-indexeddb/auto';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import type { Habit } from '../models';
import { OfflineQueue } from '../offline-queue';
import { type FetchMock, habit, mockFetch } from '../test-support';
import { reminderNames } from './reminder-names';
import { Reminders } from './reminders';
import { type EmberWidgetPlugin, widgetSnapshot } from './widget';

describe('widget snapshot', () => {
  let mock: FetchMock;
  let reminders: Reminders;
  const update = vi.fn(async () => undefined);
  const clear = vi.fn(async () => undefined);

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    update.mockClear();
    clear.mockClear();
    mock = mockFetch();
    const device = new DeviceStore();
    const plugin = {
      createChannel: async () => undefined,
      registerActionTypes: async () => undefined,
      getPending: async () => ({ notifications: [] }),
      cancel: async () => undefined,
      removeAllDeliveredNotifications: async () => undefined,
      checkPermissions: async () => ({ display: 'granted' }),
      schedule: async () => ({}),
    } as unknown as LocalNotificationsPlugin;
    const widget = { update, clear } as unknown as EmberWidgetPlugin;
    reminders = new Reminders(
      new ApiClient(new Http({ native: true, apiBase: '' }), new OfflineQueue(device)),
      device,
      async () => ({ LocalNotifications: plugin }),
      async () => ({ EmberWidget: widget }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const day = (state: Habit['today']['state'], count = 0) => ({
    date: '2026-11-01',
    state,
    completed: null,
    count,
  });

  it("pushes today's scheduled habits with their state after a rebuild, leaving out rest days and pauses, and tomorrow's from the schedule", async () => {
    const done = reminders.rebuild('u1', 'Europe/Berlin');
    (await mock.next('GET', '/api/habits')).respond(200, [
      { ...habit, id: 1, name: 'Walk', timesPerDay: 3, today: day('partial', 2) },
      { ...habit, id: 2, name: 'Stretch', today: day('offday') },
      { ...habit, id: 3, name: 'Read', today: day('paused') },
      { ...habit, id: 4, name: 'Water', today: day('done', 1) },
      { ...habit, id: 5, name: 'Journal', today: day('pending') },
    ]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await done;

    expect(update).toHaveBeenCalledWith({
      userId: 'u1',
      date: '2026-11-01',
      timeZone: 'Europe/Berlin',
      habits: [
        { id: 1, name: 'Walk', state: 'partial', count: 2, timesPerDay: 3 },
        { id: 4, name: 'Water', state: 'done', count: 1, timesPerDay: 1 },
        { id: 5, name: 'Journal', state: 'open', count: 0, timesPerDay: 1 },
      ],
      more: 0,
      next: {
        date: '2026-11-02',
        habits: [
          { id: 1, name: 'Walk', state: 'open', count: 0, timesPerDay: 3 },
          { id: 2, name: 'Stretch', state: 'open', count: 0, timesPerDay: 1 },
          { id: 3, name: 'Read', state: 'open', count: 0, timesPerDay: 1 },
          { id: 4, name: 'Water', state: 'open', count: 0, timesPerDay: 1 },
        ],
        more: 1,
      },
    });
  });

  it('shows four rows and counts the rest as more', () => {
    const habits = Array.from({ length: 8 }, (_, i) => ({ ...habit, id: i + 1 }));

    const snapshot = widgetSnapshot('u1', 'Europe/Berlin', '2026-11-01', habits);

    expect(snapshot.habits.map((h) => h.id)).toEqual([1, 2, 3, 4]);
    expect(snapshot.more).toBe(4);
  });

  it('clears the widget and the names setting with the reminders', async () => {
    reminderNames.set(true);

    await reminders.clearAll();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(reminderNames.get()).toBe(false);
    expect(localStorage.getItem('ember.reminderNames')).toBeNull();
  });
});
