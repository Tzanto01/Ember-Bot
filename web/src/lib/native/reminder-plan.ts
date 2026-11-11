import { addDays, startOfWeek, weekdayIndex } from '../local-date';
import { type Habit, type LocalDateString, reminderTimesOf, type Routine, weekdays } from '../models';

/** One local notification to schedule: for one habit (`habitId`) or for a routine's pending habits (`routineId`). */
export interface PlannedReminder {
  /** Unique within one plan and stable across plans for the same habit or routine, date, time and kind; see {@link reminderId}. */
  id: number;
  habitId?: number;
  routineId?: number;
  date: LocalDateString;
  /** UTC instant in milliseconds. */
  at: number;
  /** The reminder time on the local wall clock, `HH:mm`. */
  time: string;
  /** True for the follow-up planned `secondReminderMinutes` after the first reminder. */
  second?: boolean;
}

/** Days ahead to schedule, today included, so reminders keep coming for two weeks while the app stays closed. */
export const planDays = 14;
/** Most notifications kept pending, below Android's limit of 500 alarms per app; the soonest win. */
export const planCap = 400;

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

/**
 * The notification id for one reminder: a positive 31-bit FNV-1a hash of `habit` or `routine`, the id, the local
 * date, the `HH:mm` time and whether it's the second reminder. The same reminder keeps its id when the plan is
 * rebuilt, so Android replaces it rather than showing it twice.
 */
export function reminderId(
  reminder: Pick<PlannedReminder, 'habitId' | 'routineId' | 'date' | 'time' | 'second'>,
): number {
  const key = `${reminder.habitId !== undefined ? `h${reminder.habitId}` : `r${reminder.routineId}`}|${reminder.date}|${reminder.time}|${reminder.second ? 2 : 1}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return (hash & 0x7fffffff) || 1;
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

function weekMet(habit: Habit, date: LocalDateString): boolean {
  const week = habit.stats.week;
  return (
    habit.frequency === 'weekly' &&
    !!week &&
    week.done >= week.target &&
    startOfWeek(date) === startOfWeek(habit.today.date)
  );
}

function pendingOn(habit: Habit, date: LocalDateString): boolean {
  if (habit.today.date === date) return habit.today.state === 'pending' || habit.today.state === 'partial';
  return scheduledOn(habit, date);
}

/**
 * The local notifications for the next {@link planDays} local days in `timeZone` (the account's, never the
 * device's), with the bot dispatcher's rules. Habits with the `mobile` channel fire at each of their reminder times
 * on scheduled days only (started, not paused, a listed weekday), not once today is done, and
 * for weekly habits not for the rest of the week (Monday to Sunday) once its target is met. A routine with a reminder
 * time and the `mobile` channel fires once a day while any member habit is still pending or partial (today from
 * `habit.today`, later days when scheduled); its members' own reminders are skipped. Instants already past are
 * dropped. With `secondMinutes` above 0 each reminder gets a follow-up (`second`) that many minutes later, unless
 * it falls on another local day or the habit's next reminder time that day comes first. Sorted soonest first,
 * capped at {@link planCap}, with ids from {@link reminderId} (a collision moves to the next free id).
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
  const plan = (reminder: Omit<PlannedReminder, 'id' | 'second'>, nextAt = Infinity) => {
    if (reminder.at > now) planned.push(reminder);
    if (secondMinutes <= 0) return;
    const at = reminder.at + secondMinutes * 60_000;
    if (at > now && at < nextAt && localDate(at, timeZone) === reminder.date)
      planned.push({ ...reminder, at, second: true });
  };
  const overridden = new Set(routines.filter((r) => r.reminderTime).flatMap((r) => r.habitIds));
  for (const habit of habits) {
    const times = reminderTimesOf(habit);
    if (!times.length || !habit.reminderChannels?.includes('mobile')) continue;
    if (overridden.has(habit.id)) continue;
    for (let offset = 0; offset < planDays; offset++) {
      const date = addDays(today, offset);
      if (!scheduledOn(habit, date) || doneToday(habit, date) || weekMet(habit, date)) continue;
      const instants = times.map((time) => zonedToUtc(date, time, timeZone));
      times.forEach((time, i) => {
        if (i === 0 || +instants[i] !== +instants[i - 1]) plan({ habitId: habit.id, date, time, at: instants[i] }, instants[i + 1]);
      });
    }
  }
  for (const routine of routines) {
    if (!routine.reminderTime || !routine.reminderChannels.includes('mobile')) continue;
    const members = habits.filter((habit) => routine.habitIds.includes(habit.id));
    for (let offset = 0; offset < planDays; offset++) {
      const date = addDays(today, offset);
      if (!members.some((habit) => pendingOn(habit, date))) continue;
      plan({
        routineId: routine.id,
        date,
        time: routine.reminderTime,
        at: zonedToUtc(date, routine.reminderTime, timeZone),
      });
    }
  }
  const used = new Set<number>();
  return planned
    .sort(
      (a, b) =>
        a.at - b.at || (a.habitId ?? 0) - (b.habitId ?? 0) || (a.routineId ?? 0) - (b.routineId ?? 0),
    )
    .slice(0, planCap)
    .map((reminder) => {
      let id = reminderId(reminder);
      while (used.has(id)) id = (id % 0x7fffffff) + 1;
      used.add(id);
      return { ...reminder, id };
    });
}
