import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import { OfflineQueue } from '../offline-queue';
import { ApiError, problemToMessage } from '../problem';
import { LocalBackend, newLocalData } from './backend';
import { LocalStore } from './store';
import type { LocalData, LocalHabit } from './types';

const now = new Date('2026-11-01T10:00:00Z');
const today = '2026-11-01';

function localHabit(id: number, overrides: Partial<LocalHabit> = {}): LocalHabit {
  return {
    id,
    name: `Habit ${id}`,
    frequency: 'daily',
    weeklyTarget: null,
    days: null,
    timesPerDay: 1,
    reminderTime: null,
    reminderChannels: [],
    pausedFrom: null,
    pausedUntil: null,
    createdAt: '2026-10-20T08:00:00Z',
    routineId: null,
    routinePosition: null,
    ...overrides,
  };
}

function seed(habits: LocalHabit[] = []): LocalData {
  const data = newLocalData({ timezone: 'Europe/Berlin', theme: null }, new Date('2026-10-01T00:00:00Z'));
  data.habits = habits;
  data.profile.nextIds.habit = habits.length + 1;
  return data;
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('LocalBackend through ApiClient', () => {
  let store: LocalStore;
  let api: ApiClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  function connect(native = false): void {
    const http = new Http({ native: false, apiBase: '' });
    http.local = new LocalBackend(store, { native, now: () => now }).handle;
    api = new ApiClient(http, new OfflineQueue(new DeviceStore()));
  }

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    fetchSpy = vi.fn(() => Promise.reject(new TypeError('no network in local mode')));
    vi.stubGlobal('fetch', fetchSpy);
    store = new LocalStore();
    connect();
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('checks in past days and today and the habit, its days and the day stats follow, all without fetch', async () => {
    await store.replace(seed([localHabit(1)]));

    await api.setDay(1, '2026-10-31', true);
    const habit = await api.setDay(1, today, true);

    expect(habit.today).toEqual({ date: today, state: 'done', completed: true, count: 1 });
    expect(habit.stats.streak).toBe(2);
    expect((await api.getHabit(1)).today.state).toBe('done');
    expect((await api.getDays(1, '2026-10-31', today)).map((d) => d.state)).toEqual(['done', 'done']);
    expect(await api.dayStats(today, today)).toEqual([
      { date: today, scheduled: 1, done: 1, partial: 0, showedUp: true },
    ]);

    const cleared = await api.clearDay(1, today);
    expect(cleared.today.state).toBe('pending');
  });

  it('stores a language choice on the device, reads it back as the profile language and rejects anything but en or de', async () => {
    await store.replace(seed());
    vi.stubGlobal('navigator', { languages: ['en-GB'], language: 'en-GB' });

    expect((await api.getMe()).language).toBe('en');
    expect((await api.updateMe({ language: 'de' })).language).toBe('de');
    expect(localStorage.getItem('ember.language')).toBe('de');
    expect((await api.getMe()).language).toBe('de');

    const bad = await rejection(api.updateMe({ language: 'fr' } as never));
    expect(bad.status).toBe(400);
    expect(bad.type).toBe('validation');
    expect(bad.problem?.errors?.['language']).toBeTruthy();
    expect(localStorage.getItem('ember.language')).toBe('de');
    localStorage.clear();
  });

  it('answers bad input with the problem types the screens read', async () => {
    await store.replace(seed([localHabit(1, { timesPerDay: 2 })]));

    const name = await rejection(api.createHabit({ name: '   ', frequency: 'daily' }));
    expect(name.status).toBe(400);
    expect(name.type).toBe('validation');
    expect(problemToMessage(name).fields['name']).toBeTruthy();

    expect((await rejection(api.setDay(1, '2026-11-02', true))).type).toBe('in_future');
    expect((await rejection(api.setDay(1, '2026-10-19', true))).type).toBe('before_habit_start');
    expect((await rejection(api.setDayCount(1, today, 3))).status).toBe(400);
    expect((await rejection(api.getHabit(99))).type).toBe('not_found');
    expect((await rejection(api.updateMe({ timezone: 'Mars/Olympus' }))).problem?.errors?.['timezone']).toBeTruthy();
    expect(
      (await rejection(api.createHabit({ name: 'All week', frequency: 'weekdays', days: [...'1234567'].map(() => 'mon') })))
        .problem?.errors?.['days'],
    ).toBeTruthy();
  });

  it('stops at 25 habits with habit_limit', async () => {
    await store.replace(seed(Array.from({ length: 25 }, (_, i) => localHabit(i + 1))));

    const error = await rejection(api.createHabit({ name: 'One more', frequency: 'daily' }));

    expect(error.status).toBe(409);
    expect(error.type).toBe('habit_limit');
  });

  it('recomputes today after timesPerDay rises, so a done day becomes partial', async () => {
    await store.replace(seed([localHabit(1, { timesPerDay: 2 })]));
    await api.setDayCount(1, today, 2);

    const habit = await api.updateHabit(1, { timesPerDay: 3 });

    expect(habit.timesPerDay).toBe(3);
    expect(habit.today.state).toBe('partial');
  });

  it('keeps several reminder times sorted on the device, the earliest when timesPerDay drops, and refuses too many', async () => {
    connect(true);
    await store.replace(seed([]));

    const created = await api.createHabit({
      name: 'Water',
      frequency: 'daily',
      timesPerDay: 3,
      reminderTimes: ['20:00', '08:00', '13:00'],
      reminderChannels: [],
    });
    expect(created).toMatchObject({ reminderTime: '08:00', reminderTimes: ['08:00', '13:00', '20:00'], reminderChannels: [] });
    expect((await api.getHabit(created.id)).reminderTimes).toEqual(['08:00', '13:00', '20:00']);

    const fewer = await api.updateHabit(created.id, { timesPerDay: 2 });
    expect(fewer.reminderTimes).toEqual(['08:00', '13:00']);

    const tooMany = await rejection(api.updateHabit(created.id, { reminderTimes: ['07:00', '12:00', '18:00'] }));
    expect(tooMany.problem?.errors?.['reminderTimes']).toBeTruthy();
    const cleared = await api.updateHabit(created.id, { reminderTimes: [] });
    expect(cleared).toMatchObject({ reminderTime: null, reminderTimes: [] });
  });

  it('keeps a habit in one routine at a time, in the listed order, and caps routines at 10', async () => {
    await store.replace(seed([localHabit(1), localHabit(2), localHabit(3)]));

    const morning = await api.createRoutine({ name: 'Morning', habitIds: [3, 1] });
    const evening = await api.createRoutine({ name: 'Evening', habitIds: [1] });

    expect(morning.habitIds).toEqual([3, 1]);
    expect(evening.habitIds).toEqual([1]);
    expect((await api.listRoutines()).map((r) => r.habitIds)).toEqual([[3], [1]]);
    expect((await api.getHabit(1)).routineId).toBe(evening.id);
    expect((await rejection(api.createRoutine({ name: 'Ghost', habitIds: [42] }))).type).toBe('not_found');

    for (let i = 0; i < 8; i++) await api.createRoutine({ name: `R${i}` });
    const full = await rejection(api.createRoutine({ name: 'Eleventh' }));
    expect(full.type).toBe('conflict');
    expect(full.problem?.detail).toBeTruthy();

    await api.deleteRoutine(evening.id);
    expect((await api.getHabit(1)).routineId).toBeNull();
  });

  it('saves plaintext notes with own moods and refuses archived or unknown moods', async () => {
    await store.replace(seed([localHabit(1)]));
    const calm = await api.createMood({ label: '  Calm  ', emoji: '🌿' });
    const old = await api.createMood({ label: 'Old' });
    await api.updateMood(old.id, { archived: true });

    const saved = await api.saveDayNote(today, { text: ' A slow walk.\nThen tea. ', mood: `custom:${calm.id}` });

    expect(calm).toMatchObject({ label: 'Calm', emoji: '🌿', archived: false });
    expect(saved.note).toEqual({ date: today, text: 'A slow walk.\nThen tea.', mood: `custom:${calm.id}` });
    expect(await api.listDayNotes()).toEqual([saved.note]);
    expect((await rejection(api.saveDayNote(today, { mood: `custom:${old.id}` }))).type).toBe('validation');
    expect((await rejection(api.saveDayNote(today, { mood: 'custom:99' }))).type).toBe('validation');
    expect((await rejection(api.saveDayNote('2026-11-02', { text: 'Tomorrow' }))).type).toBe('in_future');
  });

  it('saves a note for today without habits, while other days still need a habit and a low day stays refused', async () => {
    await store.replace(seed());

    const saved = await api.saveDayNote(today, { text: 'Rough morning.' });

    expect(saved.note).toEqual({ date: today, text: 'Rough morning.', mood: null });
    expect((await rejection(api.saveDayNote('2026-10-31', { text: 'Yesterday' }))).type).toBe('before_habit_start');
    expect((await rejection(api.markLowDay(today))).type).toBe('before_habit_start');
  });

  it('writes showStreaks false for a new profile, reads a missing one as true and saves the switch', async () => {
    await store.replace(seed());
    expect((await api.getMe()).showStreaks).toBe(false);

    const older = seed();
    delete older.profile.showStreaks;
    await store.replace(older);
    expect((await api.getMe()).showStreaks).toBe(true);

    expect((await api.updateMe({ showStreaks: false })).showStreaks).toBe(false);
    expect((await store.load())?.profile.showStreaks).toBe(false);
    const error = await rejection(api.updateMe({ showStreaks: 'no' as unknown as boolean }));
    expect(error.problem?.errors).toEqual({ showStreaks: ['Must be true or false.'] });
  });

  it('reads a missing calm mode as off and saves the switch on the device', async () => {
    await store.replace(seed());
    expect((await api.getMe()).calmMode).toBe(false);

    expect((await api.updateMe({ calmMode: true })).calmMode).toBe(true);
    expect((await store.load())?.profile.calmMode).toBe(true);
    const error = await rejection(api.updateMe({ calmMode: 'yes' as unknown as boolean }));
    expect(error.problem?.errors).toEqual({ calmMode: ['Must be true or false.'] });
  });

  it('caps active moods at 20 with conflict', async () => {
    await store.replace(seed());
    for (let i = 0; i < 20; i++) await api.createMood({ label: `Mood ${i}` });

    expect((await rejection(api.createMood({ label: 'Twenty-one' }))).type).toBe('conflict');
  });

  it('answers me for the device and refuses what needs a server', async () => {
    const data = seed();
    await store.replace(data);

    expect(await api.getMe()).toMatchObject({
      id: data.profile.userId,
      email: null,
      hasPassword: false,
      timezone: 'Europe/Berlin',
      timezoneSet: true,
      localToday: today,
      consent: { given: true, policyVersion: 'device', currentPolicyVersion: 'device' },
      journal: { encrypted: false },
    });
    expect((await rejection(api.getJournalKey())).status).toBe(404);
    expect((await rejection(api.twoFactorStatus())).status).toBe(404);
    expect((await rejection(api.importData({}))).status).toBe(404);
    expect((await rejection(api.getVapidPublicKey())).status).toBe(501);
    expect((await rejection(api.exportData('csv'))).status).toBe(400);
    await api.antiforgery();
  });

  it('keeps the second reminder setting on the device, off until chosen, and refuses other values', async () => {
    await store.replace(seed());

    expect((await api.getMe()).secondReminderMinutes).toBe(0);
    expect((await api.updateMe({ secondReminderMinutes: 30 })).secondReminderMinutes).toBe(30);
    expect((await store.load())?.profile.secondReminderMinutes).toBe(30);
    expect((await api.updateMe({ graceDaysPerWeek: 2 })).secondReminderMinutes).toBe(30);
    const error = await rejection(api.updateMe({ secondReminderMinutes: 45 as 30 }));
    expect(error.problem?.errors).toEqual({ secondReminderMinutes: ['Must be 0, 15, 30, 60 or 120.'] });
    expect((await api.getMe()).secondReminderMinutes).toBe(30);
  });

  it('exports the device data as a format v2 backup file without recording the backup time', async () => {
    await store.replace(seed([localHabit(1)]));

    const file = await api.exportData('json');

    expect(file.fileName).toBe('ember-backup-2026-11-01.json');
    const doc = JSON.parse(await file.blob.text());
    expect(doc.format_version).toBe(2);
    expect(doc.habits[0]).toMatchObject({ id: 1, name: 'Habit 1', times_per_day: 1, routine_id: null });
    expect((await store.load())?.profile.lastBackupAt).toBeNull();
  });

  it('clamps exported check-in counts to the times per day', async () => {
    const data = seed([localHabit(1, { timesPerDay: 2 })]);
    data.logs = [{ habitId: 1, date: '2026-10-25', completed: true, count: 5 }];
    await store.replace(data);

    const doc = JSON.parse(await (await api.exportData('json')).blob.text());

    expect(doc.logs).toEqual([{ habit_id: 1, date: '2026-10-25', completed: true, count: 2 }]);
  });

  it.each([
    [false, []],
    [true, ['mobile']],
  ])('gives new habits and routines the reminder channels of the build (native %s)', async (native, channels) => {
    await store.replace(seed());
    connect(native);

    expect((await api.createHabit({ name: 'Read', frequency: 'daily' })).reminderChannels).toEqual(channels);
    expect((await api.createRoutine({ name: 'Night' })).reminderChannels).toEqual(channels);
  });
});
