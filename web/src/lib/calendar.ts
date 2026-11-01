import { addDays, addMonths, isSameMonth, monthWeeks, startOfMonth } from './local-date';
import type { DayEntry, DayState, LocalDateString } from './models';

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
}

/** Words for a day state, used in accessible names and the legend. Never "missed". */
export const dayStateWords: Record<DayState, string> = {
  done: 'done',
  notdone: 'not checked in',
  pending: 'still open',
  lowday: 'low day, resting',
  paused: 'paused',
  beforestart: 'before this habit started',
};

/** Accessible state text for a cell, for example "today, done" or "not yet". */
export function dayLabel(day: CalendarDay): string {
  if (day.state === null) return 'not yet';
  const words = dayStateWords[day.state];
  return day.isToday ? `today, ${words}` : words;
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
  const byDate = new Map(days.map((d) => [d.date, d.state]));
  const low = new Set(lowDays);
  return monthWeeks(month).map((week) =>
    week.map((date) => {
      const inMonth = isSameMonth(date, month);
      const future = date > localToday;
      const beforeStart = date < startDate;
      let state: DayState | null = byDate.get(date) ?? null;
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
      };
    }),
  );
}
