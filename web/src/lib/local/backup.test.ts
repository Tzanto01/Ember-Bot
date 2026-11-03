import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportDocument, newLocalData } from './backend';
import { BackupService } from './backup';
import { LocalStore } from './store';
import type { LocalData, LocalHabit, ParsedBackup } from './types';

function habit(id: number, overrides: Partial<LocalHabit> = {}): LocalHabit {
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
    createdAt: '2026-10-01T08:00:00.000Z',
    routineId: null,
    routinePosition: null,
    ...overrides,
  };
}

function sample(): LocalData {
  const data = newLocalData({ timezone: 'Europe/Berlin', theme: 'tidepool' }, new Date('2026-09-01T00:00:00Z'));
  data.profile.graceDaysPerWeek = 2;
  data.habits = [
    habit(1, { routineId: 1, routinePosition: 1, reminderTime: '07:30', reminderChannels: ['mobile'] }),
    habit(2, { frequency: 'weekdays', days: ['mon', 'fri'], timesPerDay: 3, routineId: 1, routinePosition: 0 }),
    habit(3, { frequency: 'weekly', weeklyTarget: 4, pausedFrom: '2026-10-10', pausedUntil: '2026-10-20' }),
  ];
  data.logs = [
    { habitId: 1, date: '2026-10-02', completed: true, count: 1 },
    { habitId: 2, date: '2026-10-02', completed: false, count: 2 },
    { habitId: 3, date: '2026-10-05', completed: true, count: 1 },
  ];
  data.lowDays = ['2026-10-03'];
  data.routines = [{ id: 1, name: 'Morning', reminderTime: '07:00', reminderChannels: ['mobile'] }];
  data.moods = [
    { id: 1, label: 'Calm', emoji: '🌿', archived: false },
    { id: 2, label: 'Old', emoji: null, archived: true },
  ];
  data.notes = [
    { date: '2026-10-02', text: 'Walked.\nSlept well.', mood: 'custom:1' },
    { date: '2026-10-03', text: null, mood: 'custom:2' },
    { date: '2026-10-04', text: 'Quiet day', mood: 'good' },
  ];
  data.profile.nextIds = { habit: 4, routine: 2, mood: 3 };
  return data;
}

function fileText(doc: Record<string, unknown>): string {
  return JSON.stringify(doc);
}

function parsed(result: ParsedBackup | { error: string }): ParsedBackup {
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('BackupService', () => {
  let store: LocalStore;
  let backup: BackupService;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    store = new LocalStore();
    backup = new BackupService(store);
  });

  it('restores an exported backup to the same data on a fresh device, keeping that device’s id', async () => {
    const original = sample();
    await store.replace(original);
    const text = await (await backup.exportBackup()).blob.text();

    const other = new LocalStore();
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    const fresh = newLocalData({ timezone: 'UTC', theme: null }, new Date('2026-10-30T00:00:00Z'));
    await other.replace(fresh);
    const target = new BackupService(other);
    const result = parsed(target.parseBackup(text));
    await target.restoreBackup(result);
    const restored = (await other.load())!;

    expect(result.summary).toEqual({
      habits: 3,
      checkIns: 3,
      lowDays: 1,
      routines: 1,
      notes: 3,
      moods: 2,
      skippedEncrypted: 0,
    });
    const { profile, ...rest } = restored;
    const { profile: originalProfile, ...originalRest } = original;
    expect(rest).toEqual(originalRest);
    expect(profile).toEqual({
      ...fresh.profile,
      timezone: originalProfile.timezone,
      graceDaysPerWeek: 2,
      theme: 'tidepool',
      nextIds: originalProfile.nextIds,
    });
  });

  it('gives restored records ids this device never used', async () => {
    const current = sample();
    current.profile.nextIds = { habit: 10, routine: 5, mood: 7 };
    await store.replace(current);

    await backup.restoreBackup(parsed(backup.parseBackup(fileText(exportDocument(sample())))));
    const restored = (await store.load())!;

    expect(restored.habits.map((h) => h.id)).toEqual([10, 11, 12]);
    expect(restored.logs.map((l) => l.habitId)).toEqual([10, 11, 12]);
    expect(restored.habits[0].routineId).toBe(5);
    expect(restored.notes.map((n) => n.mood)).toEqual(['custom:7', 'custom:8', 'good']);
    expect(restored.profile.nextIds).toEqual({ habit: 13, routine: 6, mood: 9 });
  });

  it('leaves encrypted moods and entries out, keeping the text of an entry whose mood was encrypted', () => {
    const doc = exportDocument(sample());
    doc['moods'] = [{ id: 9, encrypted: { v: 1, iv: 'aaaa', ct: 'bbbb' }, archived: false }];
    doc['day_notes'] = [
      { date: '2026-10-02', text: 'Kept text', mood: 'custom:9' },
      { date: '2026-10-03', encrypted: { v: 1, iv: 'aaaa', ct: 'bbbb' } },
    ];

    const result = parsed(backup.parseBackup(fileText(doc)));

    expect(result.summary.skippedEncrypted).toBe(2);
    expect(result.data.moods).toEqual([]);
    expect(result.data.notes).toEqual([{ date: '2026-10-02', text: 'Kept text', mood: null }]);
  });

  it.each<[string, (doc: Record<string, unknown>) => unknown, string]>([
    ['no format version', (doc) => delete doc['format_version'], 'different version'],
    ['format version 1', (doc) => (doc['format_version'] = 1), 'different version'],
    ['a log for an unknown habit', (doc) => (doc['logs'] as unknown[]).push({ habit_id: 77, date: '2026-10-09', completed: true, count: 1 }), "can't be read"],
    ['two logs for one habit day', (doc) => (doc['logs'] as unknown[]).push({ habit_id: 1, date: '2026-10-02', completed: true, count: 1 }), "can't be read"],
    ['an unknown routine', (doc) => ((doc['habits'] as Record<string, unknown>[])[0]['routine_id'] = 5), "can't be read"],
    ['an unknown own mood', (doc) => ((doc['day_notes'] as Record<string, unknown>[])[0]['mood'] = 'custom:42'), "can't be read"],
    ['a count above 10', (doc) => ((doc['logs'] as Record<string, unknown>[])[0]['count'] = 11), "can't be read"],
    ['a bad date', (doc) => ((doc['logs'] as Record<string, unknown>[])[0]['date'] = '2026-02-30'), "can't be read"],
    ['a bad time', (doc) => ((doc['habits'] as Record<string, unknown>[])[0]['reminder_time'] = '25:00'), "can't be read"],
    ['all seven weekdays', (doc) => ((doc['habits'] as Record<string, unknown>[])[1]['days'] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), "can't be read"],
    ['a note over 2000 characters', (doc) => ((doc['day_notes'] as Record<string, unknown>[])[0]['text'] = 'x'.repeat(2001)), "can't be read"],
    ['26 habits', (doc) => (doc['habits'] = Array.from({ length: 26 }, (_, i) => ({ ...(doc['habits'] as object[])[0], id: i + 1, routine_id: null }))), 'more than 25 habits'],
    ['11 routines', (doc) => (doc['routines'] = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `R${i}` }))), 'more than 10 routines'],
  ])('rejects a file with %s', (_name, change, message) => {
    const doc = exportDocument(sample());
    change(doc);

    const result = backup.parseBackup(fileText(doc));

    expect('error' in result && result.error).toContain(message);
  });

  it('rejects text that is too big or not an Ember backup', () => {
    expect(backup.parseBackup(' '.repeat(5 * 1024 * 1024 + 1))).toEqual({
      error: 'This file is too big to be an Ember backup.',
    });
    expect(backup.parseBackup('not json')).toEqual({ error: "This file isn't an Ember backup." });
    expect(backup.parseBackup('[1,2]')).toEqual({ error: "This file isn't an Ember backup." });
    expect(backup.parseBackup('{"hello":"world"}')).toEqual({ error: "This file isn't an Ember backup." });
  });

  it('ignores __proto__ and unknown keys without polluting objects', () => {
    const text = fileText(exportDocument(sample()))
      .replace('{"format_version":2', '{"__proto__":{"polluted":true},"format_version":2')
      .replace('"name":"Habit 1"', '"name":"Habit 1","__proto__":{"polluted":true},"constructor":{"x":1},"extra":5');

    const result = parsed(backup.parseBackup(text));

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(result.data.habits[0])).toBe(Object.prototype);
    expect(Object.keys(result.data.habits[0]).sort()).toEqual(Object.keys(habit(1)).sort());
    expect((result.data.habits[0] as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('is due 30 days after the last backup, and a snooze quiets it for 30 days', async () => {
    const data = sample();
    data.profile.createdAt = '2026-09-01T00:00:00.000Z';
    await store.replace(data);

    expect(await backup.backupReminderDue(new Date('2026-09-30T23:59:00Z'))).toBe(false);
    expect(await backup.backupReminderDue(new Date('2026-10-01T00:00:00Z'))).toBe(true);

    await backup.snoozeBackupReminder(new Date('2026-10-01T00:00:00Z'));
    expect(await backup.backupReminderDue(new Date('2026-10-30T00:00:00Z'))).toBe(false);
    expect(await backup.backupReminderDue(new Date('2026-10-31T00:00:00Z'))).toBe(true);

    await store.update((d) => ({ ...d, profile: { ...d.profile, lastBackupAt: '2026-10-25T00:00:00.000Z' } }));
    expect(await backup.backupReminderDue(new Date('2026-11-01T00:00:00Z'))).toBe(false);
  });
});
