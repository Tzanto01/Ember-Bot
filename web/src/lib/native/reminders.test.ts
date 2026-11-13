import 'fake-indexeddb/auto';
import type { LocalNotificationsPlugin, ScheduleOptions } from '@capacitor/local-notifications';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import type { Habit, ReminderDestination, Routine } from '../models';
import { OfflineQueue } from '../offline-queue';
import { type FetchMock, habit, mockFetch } from '../test-support';
import { applyTheme } from '../theme';
import { reminderNames } from './reminder-names';
import { planDays } from './reminder-plan';
import { doneActionType, Reminders, reminderBody, secondReminderBody } from './reminders';
import type { EmberWidgetPlugin } from './widget';

const zone = 'Europe/Berlin';
const reminded: Habit = { ...habit, reminderTime: '20:00', reminderChannels: ['mobile'] };

describe('Reminders', () => {
  let mock: FetchMock;
  let device: DeviceStore;
  let reminders: Reminders;
  let schedule: Mock<(options: ScheduleOptions) => Promise<unknown>>;
  let getPending: Mock;
  let cancel: Mock;
  let checkPermissions: Mock;
  let requestPermissions: Mock;
  let checkExact: Mock;
  let changeExact: Mock;
  let exactAlarms: boolean;

  beforeEach(async () => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    mock = mockFetch();
    device = new DeviceStore();
    schedule = vi.fn<(options: ScheduleOptions) => Promise<unknown>>(async () => ({}));
    getPending = vi.fn(async () => ({ notifications: [] }));
    cancel = vi.fn(async () => undefined);
    checkPermissions = vi.fn(async () => ({ display: 'granted' }));
    requestPermissions = vi.fn(async () => ({ display: 'granted' }));
    checkExact = vi.fn(async () => ({ exact_alarm: 'denied' }));
    changeExact = vi.fn(async () => ({ exact_alarm: 'granted' }));
    exactAlarms = false;
    const plugin = {
      checkExactNotificationSetting: checkExact,
      changeExactNotificationSetting: changeExact,
      createChannel: async () => undefined,
      getPending,
      cancel,
      checkPermissions,
      requestPermissions,
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
      () => exactAlarms,
    );
    await device.saveHabits({ userId: 'u1', timeZone: zone, habits: [reminded] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    reminderNames.set(false);
    localStorage.clear();
  });

  const phone: ReminderDestination = {
    id: 'phone-5',
    kind: 'phone',
    label: 'Pixel 8',
    enabled: true,
    current: true,
  };

  async function phoneRegistered(answer: ReminderDestination | null = phone) {
    const call = await mock.next('POST', '/api/me/phones');
    if (answer) call.respond(200, answer);
    else call.fail();
    return call;
  }

  async function rebuildOnline(habits: Habit[], routines: unknown[] = []) {
    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, habits);
    (await mock.next('GET', '/api/routines')).respond(200, routines);
    await phoneRegistered();
    await done;
    return schedule.mock.calls[0][0].notifications;
  }

  const scheduledAt = () =>
    schedule.mock.calls[0][0].notifications.map((n) => n.schedule?.at?.toISOString());

  it("offline, plans from the cached habits with the queued check-in applied, so today's reminder is cancelled", async () => {
    localStorage.setItem('ember.reminderPhone', JSON.stringify({ id: 'phone-5', enabled: true }));
    await device.addEdit('u1', { habitId: 1, date: '2026-11-01', completed: true });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).fail();
    await done;

    const at = scheduledAt();
    expect(at).toHaveLength(planDays - 1);
    expect(at[0]).toBe('2026-11-02T19:00:00.000Z');
  });

  it('asks for the notification permission when the phone never asked, then schedules once granted', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });
    requestPermissions.mockImplementation(async () => {
      checkPermissions.mockResolvedValue({ display: 'granted' });
      return { display: 'granted' };
    });

    const notifications = await rebuildOnline([reminded]);

    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(planDays);
  });

  it('schedules inexact alarms while exact ones are not allowed, so a rebuild never opens the setting', async () => {
    const notifications = await rebuildOnline([reminded]);

    expect(notifications.every((n) => n.isExactNotification === false)).toBe(true);
    expect(changeExact).not.toHaveBeenCalled();
  });

  it('schedules exact alarms once Android allows them, so reminders arrive on time', async () => {
    checkExact.mockResolvedValue({ exact_alarm: 'granted' });

    const notifications = await rebuildOnline([reminded]);

    expect(notifications.every((n) => n.isExactNotification === true)).toBe(true);
  });

  it('in the beta app, opens the Alarms & reminders setting once after notifications are allowed', async () => {
    exactAlarms = true;

    expect(await reminders.requestPermission()).toBe(true);
    expect(await reminders.requestPermission()).toBe(true);

    expect(changeExact).toHaveBeenCalledTimes(1);
  });

  it('never opens the Alarms & reminders setting outside the beta app or when notifications are denied', async () => {
    await reminders.requestPermission();
    exactAlarms = true;
    checkPermissions.mockResolvedValue({ display: 'denied' });
    requestPermissions.mockResolvedValue({ display: 'denied' });
    await reminders.requestPermission();

    expect(changeExact).not.toHaveBeenCalled();
  });

  it('leaves pending reminders alone while the plan is unchanged, and replaces them when it changes', async () => {
    await rebuildOnline([reminded]);
    await rebuildOnline([reminded]);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(getPending).toHaveBeenCalledTimes(1);

    await rebuildOnline([{ ...reminded, reminderTime: '21:00' }]);

    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('schedules one notification with Done per reminder time, keeps their ids across edits, and cancels them with the habit', async () => {
    const water: Habit = {
      ...reminded,
      id: 2,
      name: 'Water',
      timesPerDay: 3,
      reminderTime: '08:00',
      reminderTimes: ['08:00', '13:00', '20:00'],
    };
    const first = await rebuildOnline([water]);

    expect(first).toHaveLength(2 + 3 * (planDays - 1));
    expect(first.slice(0, 3).map((n) => n.schedule?.at?.toISOString())).toEqual([
      '2026-11-01T12:00:00.000Z',
      '2026-11-01T19:00:00.000Z',
      '2026-11-02T07:00:00.000Z',
    ]);
    expect(first.every((n) => n.actionTypeId === doneActionType && n.title === 'Ember')).toBe(true);

    getPending.mockResolvedValue({ notifications: first.map(({ id }) => ({ id })) });
    const edited = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded, water]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered();
    await edited;
    const second = schedule.mock.calls[1][0].notifications;
    const waterIds = (list: typeof first) =>
      list.filter((n) => (n.extra as { habitId: number }).habitId === 2).map((n) => n.id);

    expect(waterIds(second)).toEqual(waterIds(first));
    expect(cancel).toHaveBeenLastCalledWith({ notifications: first.map(({ id }) => ({ id })) });

    getPending.mockResolvedValue({ notifications: second.map(({ id }) => ({ id })) });
    const deleted = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, []);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered();
    await deleted;

    expect(schedule).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenLastCalledWith({ notifications: second.map(({ id }) => ({ id })) });
  });

  it('schedules the same plan again after the reminders were cleared', async () => {
    await rebuildOnline([reminded]);
    await reminders.clearAll();

    await rebuildOnline([reminded]);

    expect(schedule).toHaveBeenCalledTimes(2);
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
    await phoneRegistered();
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

  it('names no habit but still offers Done for that habit and day while "Show habit names" is off', async () => {
    const [first] = await rebuildOnline([reminded]);

    expect(first).toMatchObject({ title: 'Ember', body: reminderBody(), actionTypeId: doneActionType });
    expect(first.extra).toEqual({ userId: 'u1', habitId: 1, date: '2026-11-01' });
    expect(JSON.stringify(first)).not.toContain('Walk');
    expect(reminders.wasIssued(first.id, first.extra)).toBe(true);
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
      body: reminderBody(),
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

  it('follows each reminder with a second one under its own id, with the same title, Done and day', async () => {
    reminderNames.set(true);
    const done = reminders.rebuild('u1', zone, 30);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered();
    await done;
    const [first, second] = schedule.mock.calls[0][0].notifications;

    expect(first).toMatchObject({ title: 'Walk', body: reminderBody(), actionTypeId: doneActionType });
    expect(second).toMatchObject({
      title: 'Walk',
      body: secondReminderBody(),
      actionTypeId: doneActionType,
      extra: first.extra,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.schedule?.at?.toISOString()).toBe('2026-11-01T19:30:00.000Z');
    expect(reminders.wasIssued(second.id, second.extra)).toBe(true);
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
    localStorage.removeItem('ember.reminderPlanned');

    const again = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered();
    await again;

    expect(localStorage.getItem('ember.reminderIssued')).toBe(once);
    expect(JSON.parse(once ?? '[]')).toHaveLength(planDays);
    expect(reminders.wasIssued(99, stale)).toBe(false);

    localStorage.removeItem('ember.reminderPlanned');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const full = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered();
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
    await phoneRegistered();
    await done;

    expect(schedule.mock.calls[0][0].notifications[0].extra).toMatchObject({ routineId: 4 });
    expect((await device.habits('u1'))?.routines).toEqual([routine]);
  });

  it('offline, plans the cached routines too', async () => {
    localStorage.setItem('ember.reminderPhone', JSON.stringify({ id: 'phone-5', enabled: true }));
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

  it('registers this phone by its install id and model, and follows Settings and per-item choices for it', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) Chrome/130' });
    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [
      reminded,
      { ...reminded, id: 2, reminderExclusions: ['phone-5'] },
    ]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    const registration = (await phoneRegistered()) as { body: { installId: string; label: string } };
    await done;

    expect(registration.body).toEqual({ installId: localStorage.getItem('ember.installId'), label: 'Pixel 8' });
    expect(registration.body.installId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(scheduledAt()).toHaveLength(planDays);
    expect(schedule.mock.calls[0][0].notifications.every((n) => (n.extra as { habitId: number }).habitId === 1)).toBe(
      true,
    );

    getPending.mockResolvedValue({ notifications: [{ id: 1 }] });
    const off = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    expect((await phoneRegistered({ ...phone, enabled: false })).body).toEqual(registration.body);
    await off;

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenLastCalledWith({ notifications: [{ id: 1 }] });
  });

  it('plans with the last registration when registering fails, and with nothing when it never succeeded', async () => {
    const never = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered(null);
    await never;

    expect(schedule).not.toHaveBeenCalled();

    await rebuildOnline([reminded]);
    localStorage.removeItem('ember.reminderPlanned');
    const failed = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await phoneRegistered(null);
    await failed;

    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it('forgets the cached registration on clearAll, so an offline rebuild plans nothing and asks no server', async () => {
    await rebuildOnline([reminded]);
    await reminders.clearAll();
    await device.saveHabits({ userId: 'u1', timeZone: zone, habits: [reminded] });

    const offline = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).fail();
    await offline;

    expect(mock.all.filter((c) => c.url === '/api/me/phones')).toHaveLength(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('registers nothing while notifications are denied', async () => {
    checkPermissions.mockResolvedValue({ display: 'denied' });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [reminded]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await done;

    expect(mock.all.some((c) => c.url === '/api/me/phones')).toBe(false);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('never asks for the notification permission on a rebuild when no item has a reminder', async () => {
    checkPermissions.mockResolvedValue({ display: 'prompt' });

    const done = reminders.rebuild('u1', zone);
    (await mock.next('GET', '/api/habits')).respond(200, [habit]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await done;

    expect(requestPermissions).not.toHaveBeenCalled();
    expect(mock.all.some((c) => c.url === '/api/me/phones')).toBe(false);
  });

  it('in no-account mode, registers nothing and plans the habits with the mobile channel', async () => {
    localStorage.setItem('ember.mode', 'local');

    const done = reminders.rebuild('u1', zone, 30);
    (await mock.next('GET', '/api/habits')).respond(200, [
      { ...reminded, serverReminders: true, reminderExclusions: ['phone-5'] },
      { ...reminded, id: 2, reminderChannels: [] },
    ]);
    (await mock.next('GET', '/api/routines')).respond(200, []);
    await done;
    const notifications = schedule.mock.calls[0][0].notifications;

    expect(mock.all.some((c) => c.url === '/api/me/phones')).toBe(false);
    expect(notifications).toHaveLength(2 * planDays);
    expect(notifications.every((n) => (n.extra as { habitId: number }).habitId === 1)).toBe(true);
  });

  it('turns this phone on from Settings: asks for the permission, registers it and switches its destination on', async () => {
    const enabling = reminders.enablePhone();
    (await mock.next('POST', '/api/me/phones')).respond(200, { ...phone, enabled: false });
    const patch = await mock.next('PATCH', '/api/me/reminder-destinations/phone-5');
    expect(patch.body).toEqual({ enabled: true });
    patch.respond(200, phone);

    expect(await enabling).toEqual(phone);
    expect(JSON.parse(localStorage.getItem('ember.reminderPhone') ?? 'null')).toEqual({ id: 'phone-5', enabled: true });
  });

  it('turns this phone on with nothing sent when the permission is refused', async () => {
    checkPermissions.mockResolvedValue({ display: 'denied' });
    requestPermissions.mockResolvedValue({ display: 'denied' });

    expect(await reminders.enablePhone()).toBeNull();
    expect(mock.all).toHaveLength(0);
  });

  it('calls the native notifications plugin without awaiting the proxy itself', async () => {
    const native = new Reminders(
      new ApiClient(new Http({ native: true, apiBase: '' }), new OfflineQueue(device)),
      device,
    );

    expect(await native.requestPermission()).toBe(true);
  });
});

vi.mock('@capacitor/local-notifications', async () => ({
  LocalNotifications: (await import('../test-support')).capacitorPlugin({
    checkPermissions: async () => ({ display: 'granted' }),
  }),
}));
