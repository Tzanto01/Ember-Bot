import { addDays, addMonths, isSameMonth, monthWeeks, startOfMonth } from './local-date';
import { type DayEntry, type DayState, type Habit, type LocalDateString, weekdays } from './models';

/** One cell of the month grid. `state` is null for days that haven't happened yet. */
export interface CalendarDay {
  date: LocalDateString;
  state: DayState | null;
  /** True when the user can change this day: in the shown month, from the habit's start, up to today. */
  editable: boolean;
  inMonth: boolean;
  isToday: boolean;
  /** True when the account marked this day as a low day. */
  lowDay: boolean;
  /** Check-ins that day (0 when nothing is recorded). */
  count: number;
}

/** Words for a day state, used in accessible names and the legend. Never "missed". */
export const dayStateWords: Record<DayState, string> = {
  done: 'done',
  notdone: 'not checked in',
  pending: 'still open',
  lowday: 'low day, resting',
  paused: 'paused',
  beforestart: 'before this habit started',
  offday: 'rest day, nothing planned',
  partial: 'partly done',
};

/** The state words, with "2 of 3 done" for a partial day when the habit's `timesPerDay` is known. */
export function stateWords(state: DayState, count = 0, timesPerDay = 1): string {
  return state === 'partial' && timesPerDay > 1 ? `${count} of ${timesPerDay} done` : dayStateWords[state];
}

/** Accessible state text for a cell, for example "today, done", "2 of 3 done" or "not yet". */
export function dayLabel(day: CalendarDay, timesPerDay = 1): string {
  if (day.state === null) return 'not yet';
  const words = stateWords(day.state, day.count, timesPerDay);
  return day.isToday ? `today, ${words}` : words;
}

/** True when `date` is outside a set-weekdays habit's schedule (a rest day). */
export function isOffday(habit: Pick<Habit, 'frequency' | 'days'>, date: LocalDateString): boolean {
  if (habit.frequency !== 'weekdays' || !habit.days) return false;
  const weekday = weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
  return !habit.days.includes(weekday);
}

/**
 * The days to fetch for `month` (any date in it): clamped to the habit's start and to today.
 * Null when nothing in the month can have data.
 */
export function monthRange(
  month: LocalDateString,
  startDate: LocalDateString,
  localToday: LocalDateString,
): { from: LocalDateString; to: LocalDateString } | null {
  const first = startOfMonth(month);
  const monthEnd = addDays(addMonths(month, 1), -1);
  const from = first < startDate ? startDate : first;
  const to = monthEnd > localToday ? localToday : monthEnd;
  return from <= to ? { from, to } : null;
}

/** True when the month before `month` still contains days from the habit's start. */
export function canGoPrevious(month: LocalDateString, startDate: LocalDateString): boolean {
  return startOfMonth(month) > startOfMonth(startDate);
}

/** True when the month after `month` is not later than today's month. */
export function canGoNext(month: LocalDateString, localToday: LocalDateString): boolean {
  return startOfMonth(month) < startOfMonth(localToday);
}

/**
 * Monday-start weeks of the month containing `month`, each day resolved from the fetched `days`
 * (the server's state wins), the account's `lowDays`, the habit's `startDate` and the user's `localToday`.
 */
export function buildMonth(
  month: LocalDateString,
  days: readonly DayEntry[],
  lowDays: readonly LocalDateString[],
  startDate: LocalDateString,
  localToday: LocalDateString,
): CalendarDay[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const low = new Set(lowDays);
  return monthWeeks(month).map((week) =>
    week.map((date) => {
      const inMonth = isSameMonth(date, month);
      const future = date > localToday;
      const beforeStart = date < startDate;
      const entry = byDate.get(date);
      let state: DayState | null = entry?.state ?? null;
      if (state === null && !future) {
        state = beforeStart
          ? 'beforestart'
          : low.has(date)
            ? 'lowday'
            : date === localToday
              ? 'pending'
              : 'notdone';
      }
      return {
        date,
        state,
        editable: inMonth && !future && !beforeStart,
        inMonth,
        isToday: date === localToday,
        lowDay: low.has(date),
        count: entry?.count ?? 0,
      };
    }),
  );
}
