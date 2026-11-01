import { addDays } from '../local-date';
import type { Habit, LocalDateString } from '../models';

/** One local notification to schedule. */
export interface PlannedReminder {
  /** 1-based, unique within one plan. */
  id: number;
  habitId: number;
  date: LocalDateString;
  /** UTC instant in milliseconds. */
  at: number;
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

/**
 * The local notifications for the next {@link planDays} local days in `timeZone` (the account's, never the
 * device's): habits with the `mobile` channel and a reminder time, skipping days before the habit started,
 * paused days, today when it's already done, and instants already past (the bot dispatcher's rules).
 * Sorted soonest first and capped at {@link planCap}.
 */
export function planReminders(habits: Habit[], timeZone: string, now: number): PlannedReminder[] {
  const today = localDate(now, timeZone);
  const planned: Omit<PlannedReminder, 'id'>[] = [];
  for (const habit of habits) {
    if (!habit.reminderTime || !habit.reminderChannels?.includes('mobile')) continue;
    for (let offset = 0; offset < planDays; offset++) {
      const date = addDays(today, offset);
      if (date < habit.startDate || pausedOn(habit, date)) continue;
      if (habit.today.date === date && habit.today.state === 'done') continue;
      const at = zonedToUtc(date, habit.reminderTime, timeZone);
      if (at > now) planned.push({ habitId: habit.id, date, at });
    }
  }
  return planned
    .sort((a, b) => a.at - b.at || a.habitId - b.habitId)
    .slice(0, planCap)
    .map((reminder, index) => ({ ...reminder, id: index + 1 }));
}
