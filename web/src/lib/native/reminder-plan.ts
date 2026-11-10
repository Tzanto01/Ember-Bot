import { addDays, weekdayIndex } from '../local-date';
import { type Habit, type LocalDateString, type Routine, weekdays } from '../models';

/** One local notification to schedule: for one habit (`habitId`) or for a routine's pending habits (`routineId`). */
export interface PlannedReminder {
  /** 1-based, unique within one plan. */
  id: number;
  habitId?: number;
  routineId?: number;
  date: LocalDateString;
  /** UTC instant in milliseconds. */
  at: number;
  /** True for the follow-up planned `secondReminderMinutes` after the first reminder. */
  second?: boolean;
}

/** Days ahead to schedule, today included. */
export const planDays = 7;
/** Most notifications kept pending (Android and iOS cap pending alarms); the soonest win. */
export const planCap = 60;

const parts = new Map<string, Intl.DateTimeFormat>();

function wallClock(utc: number, timeZone: string): { date: LocalDateString; minutes: number } {
  let format = parts.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    parts.set(timeZone, format);
  }
  const p = Object.fromEntries(
    format.formatToParts(new Date(utc)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    minutes: Number(p['hour']) * 60 + Number(p['minute']),
  };
}

/** The local calendar day in `timeZone` at the UTC instant `utc`. */
export function localDate(utc: number, timeZone: string): LocalDateString {
  return wallClock(utc, timeZone).date;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `time` on `date`, with Core's rules
 * (`TimezoneHelper.NextOccurrenceUtc`): a time inside a spring-forward gap moves to the first valid local
 * time after the gap; an ambiguous fall-back time uses its first (earlier) occurrence.
 */
export function zonedToUtc(date: LocalDateString, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  for (let shift = 0; shift <= 180; shift++) {
    const naive = Date.UTC(y, m - 1, d, hh, mm + shift);
    const target = wallClock(naive, 'UTC');
    const valid = [-halfDay, 0, halfDay]
      .map((around) => naive - offset(naive + around, timeZone))
      .filter((utc) => {
        const wall = wallClock(utc, timeZone);
        return wall.date === target.date && wall.minutes === target.minutes;
      });
    if (valid.length) return Math.min(...valid);
  }
  throw new Error(`No valid local time for ${date} ${time} in ${timeZone}`);
}

const halfDay = 12 * 3_600_000;

function offset(utc: number, timeZone: string): number {
  const wall = wallClock(utc, timeZone);
  const [y, m, d] = wall.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, wall.minutes) - Math.floor(utc / 60_000) * 60_000;
}

function pausedOn(habit: Habit, date: LocalDateString): boolean {
  return (
    habit.pausedUntil !== null &&
    date <= habit.pausedUntil &&
    (habit.pausedFrom === null || date >= habit.pausedFrom)
  );
}

/** True when `habit` expects a check-in on `date`: started, not paused, and a scheduled weekday for `weekdays` habits. */
export function scheduledOn(habit: Habit, date: LocalDateString): boolean {
  if (date < habit.startDate || pausedOn(habit, date)) return false;
  return habit.frequency !== 'weekdays' || !!habit.days?.includes(weekdays[weekdayIndex(date)]);
}

function doneToday(habit: Habit, date: LocalDateString): boolean {
  return (
    habit.today.date === date &&
    (habit.today.state === 'done' || habit.today.count >= (habit.timesPerDay ?? 1))
  );
}

function pendingOn(habit: Habit, date: LocalDateString): boolean {
  if (habit.today.date === date) return habit.today.state === 'pending' || habit.today.state === 'partial';
  return scheduledOn(habit, date);
}

/**
 * The local notifications for the next {@link planDays} local days in `timeZone` (the account's, never the
 * device's), with the bot dispatcher's rules. Habits with the `mobile` channel and a reminder time fire on
 * scheduled days only (started, not paused, a listed weekday), not once today is done. A routine with a reminder
 * time and the `mobile` channel fires once a day while any member habit is still pending or partial (today from
 * `habit.today`, later days when scheduled); its members' own reminders are skipped. Instants already past are
 * dropped. With `secondMinutes` above 0 each reminder gets a follow-up (`second`) that many minutes later, unless
 * it falls on another local day. Sorted soonest first and capped at {@link planCap}.
 */
export function planReminders(
  habits: Habit[],
  timeZone: string,
  now: number,
  routines: Routine[] = [],
  secondMinutes = 0,
): PlannedReminder[] {
  const today = localDate(now, timeZone);
  const planned: Omit<PlannedReminder, 'id'>[] = [];
  const plan = (reminder: Omit<PlannedReminder, 'id' | 'second'>) => {
    if (reminder.at > now) planned.push(reminder);
    if (secondMinutes <= 0) return;
    const at = reminder.at + secondMinutes * 60_000;
    if (at > now && localDate(at, timeZone) === reminder.date) planned.push({ ...reminder, at, second: true });
  };
  const overridden = new Set(routines.filter((r) => r.reminderTime).flatMap((r) => r.habitIds));
  for (const habit of habits) {
    if (!habit.reminderTime || !habit.reminderChannels?.includes('mobile')) continue;
    if (overridden.has(habit.id)) continue;
    for (let offset = 0; offset < planDays; offset++) {
      const date = addDays(today, offset);
      if (!scheduledOn(habit, date) || doneToday(habit, date)) continue;
      plan({ habitId: habit.id, date, at: zonedToUtc(date, habit.reminderTime, timeZone) });
    }
  }
  for (const routine of routines) {
    if (!routine.reminderTime || !routine.reminderChannels.includes('mobile')) continue;
    const members = habits.filter((habit) => routine.habitIds.includes(habit.id));
    for (let offset = 0; offset < planDays; offset++) {
      const date = addDays(today, offset);
      if (!members.some((habit) => pendingOn(habit, date))) continue;
      plan({ routineId: routine.id, date, at: zonedToUtc(date, routine.reminderTime, timeZone) });
    }
  }
  return planned
    .sort(
      (a, b) =>
        a.at - b.at || (a.habitId ?? 0) - (b.habitId ?? 0) || (a.routineId ?? 0) - (b.routineId ?? 0),
    )
    .slice(0, planCap)
    .map((reminder, index) => ({ ...reminder, id: index + 1 }));
}
