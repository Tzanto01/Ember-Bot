import type { ExportFile } from '../api-client';
import { t } from '../i18n';
import { isValidTimeZone } from '../local-date';
import { builtinMoods, type MoodKey, type ReminderChannel, type TimeOfDay } from '../models';
import { themes, type ThemeId } from '../theme';
import {
  exportBackupFile,
  isDate,
  isEmoji,
  isTime,
  limits,
  newLocalData,
  parseChannels,
  parseFrequency,
  parseWeekdays,
  validName,
} from './backend';
import type { LocalStore } from './store';
import type {
  BackupApi,
  LocalData,
  LocalHabit,
  LocalLog,
  LocalMood,
  LocalNote,
  LocalRoutine,
  ParsedBackup,
} from './types';

const maxChars = 5 * 1024 * 1024;
const reminderMs = 30 * 86_400_000;

const copy = {
  get notBackup() {
    return t('backup.error.notBackup');
  },
  get tooBig() {
    return t('backup.error.tooBig');
  },
  get version() {
    return t('backup.error.version');
  },
  get damaged() {
    return t('backup.error.damaged');
  },
  get habits() {
    return t('backup.error.habits', { max: limits.habits });
  },
  get routines() {
    return t('backup.error.routines', { max: limits.routines });
  },
  get moods() {
    return t('backup.error.moods', { max: limits.activeMoods });
  },
};

class Rejected extends Error {}

type Fields = Record<string, unknown>;

function damaged(): never {
  throw new Rejected(copy.damaged);
}

function field(record: Fields, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function record(value: unknown): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) damaged();
  return value as Fields;
}

function list(value: unknown, required = false): unknown[] {
  if ((value === undefined || value === null) && !required) return [];
  if (!Array.isArray(value)) damaged();
  return value;
}

function int(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) damaged();
  return value as number;
}

function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return isDate(value) ? value : damaged();
}

function time(value: unknown): TimeOfDay | null {
  if (value === undefined || value === null) return null;
  if (isTime(value)) return value;
  if (typeof value === 'string' && /^\d{2}:\d{2}:00$/.test(value) && isTime(value.slice(0, 5))) return value.slice(0, 5);
  return damaged();
}

function channels(value: unknown): ReminderChannel[] {
  if (value === undefined || value === null) return [];
  return parseChannels(value) ?? damaged();
}

function uniqueId(value: unknown, seen: Set<number>): number {
  const id = int(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (seen.has(id)) damaged();
  seen.add(id);
  return id;
}

function parse(text: string): ParsedBackup {
  if (typeof text !== 'string') throw new Rejected(copy.notBackup);
  if (text.length > maxChars) throw new Rejected(copy.tooBig);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Rejected(copy.notBackup);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Rejected(copy.notBackup);
  const doc = root as Fields;
  const version = field(doc, 'format_version');
  if (version !== 2) {
    const looksLikeEmber = Object.hasOwn(doc, 'settings') && Object.hasOwn(doc, 'habits');
    throw new Rejected(version === undefined && !looksLikeEmber ? copy.notBackup : copy.version);
  }

  const settings = record(field(doc, 'settings'));
  const timezone = field(settings, 'timezone');
  if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) damaged();
  const graceDaysPerWeek = int(field(settings, 'grace_days_per_week'), 0, 3);
  const theme = field(settings, 'theme') ?? null;
  if (theme !== null && !themes.some((t) => t.id === theme)) damaged();

  const routineList = list(field(doc, 'routines'));
  if (routineList.length > limits.routines) throw new Rejected(copy.routines);
  const routineIds = new Map<number, number>();
  const routineSeen = new Set<number>();
  const routines = routineList.map((raw, index): LocalRoutine => {
    const r = record(raw);
    const fileId = uniqueId(field(r, 'id'), routineSeen);
    routineIds.set(fileId, index + 1);
    return {
      id: index + 1,
      name: validName(field(r, 'name'), limits.routineName) ?? damaged(),
      reminderTime: time(field(r, 'reminder_time')),
      reminderChannels: channels(field(r, 'reminder_channels')),
    };
  });

  const habitList = list(field(doc, 'habits'), true);
  if (habitList.length > limits.habits) throw new Rejected(copy.habits);
  const habitIds = new Map<number, LocalHabit>();
  const habitSeen = new Set<number>();
  const habits = habitList.map((raw, index): LocalHabit => {
    const h = record(raw);
    const fileId = uniqueId(field(h, 'id'), habitSeen);
    const frequency = parseFrequency(field(h, 'frequency')) ?? damaged();
    const weeklyTarget = field(h, 'weekly_target') ?? null;
    const timesPerDay = int(field(h, 'times_per_day') ?? 1, 1, frequency === 'weekly' ? 1 : limits.timesPerDay);
    const createdAt = field(h, 'created_at');
    if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) damaged();
    const pausedFrom = optionalDate(field(h, 'paused_from'));
    const pausedUntil = optionalDate(field(h, 'paused_until'));
    if (pausedFrom && pausedUntil && pausedFrom > pausedUntil) damaged();
    const routineId = field(h, 'routine_id') ?? null;
    if (routineId !== null && !routineIds.has(routineId as number)) damaged();
    const position = field(h, 'routine_position') ?? null;
    const listed = field(h, 'reminder_times');
    const single = time(field(h, 'reminder_time'));
    const reminderTimes =
      listed === undefined || listed === null
        ? single
          ? [single]
          : []
        : [...new Set(list(listed).map((t) => time(t) ?? damaged()))].sort();
    if (reminderTimes.length > timesPerDay) damaged();
    const habit: LocalHabit = {
      id: index + 1,
      name: validName(field(h, 'name'), limits.habitName) ?? damaged(),
      frequency,
      weeklyTarget: frequency === 'weekly' ? (weeklyTarget === null ? 3 : int(weeklyTarget, 1, 6)) : null,
      days: frequency === 'weekdays' ? (parseWeekdays(field(h, 'days')) ?? damaged()) : null,
      timesPerDay,
      reminderTime: reminderTimes[0] ?? null,
      reminderTimes,
      reminderChannels: channels(field(h, 'reminder_channels')),
      pausedFrom,
      pausedUntil,
      createdAt: new Date(createdAt).toISOString(),
      routineId: routineId === null ? null : routineIds.get(routineId as number)!,
      routinePosition: position === null ? null : int(position, 0, Number.MAX_SAFE_INTEGER),
    };
    if (frequency !== 'weekly' && weeklyTarget !== null) damaged();
    habitIds.set(fileId, habit);
    return habit;
  });
  for (const routine of routines) {
    habits
      .filter((h) => h.routineId === routine.id)
      .sort((a, b) => (a.routinePosition ?? Infinity) - (b.routinePosition ?? Infinity) || a.id - b.id)
      .forEach((h, position) => (h.routinePosition = position));
  }
  for (const habit of habits) if (habit.routineId === null) habit.routinePosition = null;

  const seenDays = new Set<string>();
  const logs = list(field(doc, 'logs'), true).map((raw): LocalLog => {
    const l = record(raw);
    const habit = habitIds.get(field(l, 'habit_id') as number) ?? damaged();
    const date = optionalDate(field(l, 'date')) ?? damaged();
    const completed = field(l, 'completed');
    if (typeof completed !== 'boolean') damaged();
    const count = int(field(l, 'count') ?? (completed ? habit.timesPerDay : 0), 0, limits.timesPerDay);
    const key = `${habit.id}|${date}`;
    if (seenDays.has(key)) damaged();
    seenDays.add(key);
    return { habitId: habit.id, date, completed, count };
  });

  const lowDays = new Set<string>();
  for (const raw of list(field(doc, 'day_marks'))) {
    const mark = record(raw);
    const date = optionalDate(field(mark, 'date')) ?? damaged();
    if (typeof field(mark, 'kind') !== 'string') damaged();
    if (field(mark, 'kind') === 'low_day') lowDays.add(date);
  }

  let skippedEncrypted = 0;
  const moodIds = new Map<number, number>();
  const encryptedMoods = new Set<number>();
  const moodSeen = new Set<number>();
  const moods: LocalMood[] = [];
  for (const raw of list(field(doc, 'moods'))) {
    const m = record(raw);
    const fileId = uniqueId(field(m, 'id'), moodSeen);
    if (field(m, 'encrypted') !== undefined && field(m, 'encrypted') !== null) {
      encryptedMoods.add(fileId);
      skippedEncrypted++;
      continue;
    }
    const emoji = field(m, 'emoji') ?? null;
    if (emoji !== null && !isEmoji(emoji)) damaged();
    const archived = field(m, 'archived') ?? false;
    if (typeof archived !== 'boolean') damaged();
    const mood: LocalMood = {
      id: moods.length + 1,
      label: validName(field(m, 'label'), limits.moodLabel) ?? damaged(),
      emoji: emoji as string | null,
      archived,
    };
    moodIds.set(fileId, mood.id);
    moods.push(mood);
  }
  if (moods.filter((m) => !m.archived).length > limits.activeMoods) throw new Rejected(copy.moods);

  const noteDays = new Set<string>();
  const notes: LocalNote[] = [];
  for (const raw of list(field(doc, 'day_notes'))) {
    const n = record(raw);
    const date = optionalDate(field(n, 'date')) ?? damaged();
    if (noteDays.has(date)) damaged();
    noteDays.add(date);
    if (field(n, 'encrypted') !== undefined && field(n, 'encrypted') !== null) {
      skippedEncrypted++;
      continue;
    }
    const rawText = field(n, 'text') ?? null;
    if (rawText !== null && typeof rawText !== 'string') damaged();
    const text = rawText?.trim() || null;
    if (text !== null && text.length > limits.noteText) damaged();
    const note: LocalNote = { date, text, mood: noteMood(field(n, 'mood') ?? null, moodIds, encryptedMoods) };
    if (note.text !== null || note.mood !== null) notes.push(note);
  }

  return {
    summary: {
      habits: habits.length,
      checkIns: logs.length,
      lowDays: lowDays.size,
      routines: routines.length,
      notes: notes.length,
      moods: moods.length,
      skippedEncrypted,
    },
    data: {
      settings: { timezone, graceDaysPerWeek, theme: theme as ThemeId | null },
      habits,
      logs,
      lowDays: [...lowDays].sort(),
      routines,
      moods,
      notes,
    },
  };
}

function noteMood(value: unknown, moodIds: Map<number, number>, encrypted: Set<number>): MoodKey | null {
  if (value === null) return null;
  if ((builtinMoods as readonly unknown[]).includes(value)) return value as MoodKey;
  const match = typeof value === 'string' ? /^custom:(\d+)$/.exec(value) : null;
  if (!match) damaged();
  const fileId = Number(match[1]);
  const id = moodIds.get(fileId);
  if (id !== undefined) return `custom:${id}`;
  return encrypted.has(fileId) ? null : damaged();
}

/** Backup files of no-account mode (export format v2) and the 30-day backup reminder. */
export class BackupService implements BackupApi {
  constructor(private readonly store: LocalStore) {}

  exportBackup(): Promise<ExportFile> {
    return exportBackupFile(this.store);
  }

  parseBackup(text: string): ParsedBackup | { error: string } {
    try {
      return parse(text);
    } catch (error) {
      return { error: error instanceof Rejected ? error.message : copy.notBackup };
    }
  }

  async restoreBackup(backup: ParsedBackup): Promise<void> {
    const { settings, ...data } = backup.data;
    await this.store.upsert((stored) => {
      const current = stored ?? newLocalData({ timezone: settings.timezone, theme: settings.theme }, new Date());
      const habit = current.profile.nextIds.habit - 1;
      const routine = current.profile.nextIds.routine - 1;
      const mood = current.profile.nextIds.mood - 1;
      const next: LocalData = {
        profile: {
          ...current.profile,
          timezone: settings.timezone,
          graceDaysPerWeek: settings.graceDaysPerWeek,
          theme: settings.theme,
          nextIds: {
            habit: habit + data.habits.length + 1,
            routine: routine + data.routines.length + 1,
            mood: mood + data.moods.length + 1,
          },
        },
        habits: data.habits.map((h) => ({
          ...h,
          id: h.id + habit,
          days: h.days && [...h.days],
          reminderTimes: h.reminderTimes && [...h.reminderTimes],
          reminderChannels: [...h.reminderChannels],
          routineId: h.routineId === null ? null : h.routineId + routine,
        })),
        logs: data.logs.map((l) => ({ ...l, habitId: l.habitId + habit })),
        lowDays: [...data.lowDays],
        routines: data.routines.map((r) => ({ ...r, id: r.id + routine, reminderChannels: [...r.reminderChannels] })),
        moods: data.moods.map((m) => ({ ...m, id: m.id + mood })),
        notes: data.notes.map((n) => ({
          ...n,
          mood: n.mood?.startsWith('custom:') ? `custom:${Number(n.mood.slice(7)) + mood}` : n.mood,
        })),
      };
      return next;
    });
  }

  async backupReminderDue(now: Date = new Date()): Promise<boolean> {
    const data = await this.store.load();
    if (!data) return false;
    const { lastBackupAt, createdAt, backupReminderSnoozedUntil } = data.profile;
    if (backupReminderSnoozedUntil && now.getTime() < Date.parse(backupReminderSnoozedUntil)) return false;
    return now.getTime() - Date.parse(lastBackupAt ?? createdAt) >= reminderMs;
  }

  async markBackedUp(now: Date = new Date()): Promise<void> {
    await this.store.update((d) => {
      d.profile.lastBackupAt = now.toISOString();
      return d;
    });
  }

  async snoozeBackupReminder(now: Date = new Date()): Promise<void> {
    await this.store.update((d) => {
      d.profile.backupReminderSnoozedUntil = new Date(now.getTime() + reminderMs).toISOString();
      return d;
    });
  }
}
