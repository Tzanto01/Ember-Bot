import { isOffday } from '@/lib/calendar';
import { addDays, daysBetween } from '@/lib/local-date';
import type { DayEntry, Habit, LocalDateString } from '@/lib/models';

export type KeptHabit = Pick<Habit, 'frequency' | 'days' | 'pausedFrom' | 'pausedUntil' | 'startDate'>;

export interface KeptDays {
  /** Kept days in the window. */
  kept: number;
  /** Days in the window from the habit's start: `window`, or fewer for a younger habit. */
  span: number;
}

/** The first day of the `window` days ending on `today`, but not before the habit's start. */
export function windowStart(habit: Pick<Habit, 'startDate'>, today: LocalDateString, window: number): LocalDateString {
  const cutoff = addDays(today, 1 - window);
  return habit.startDate > cutoff ? habit.startDate : cutoff;
}

/**
 * Kept days among the last `window` days ending on `today` (Core `HabitService.FlexibleStreak`): a day is kept when
 * it was completed (offdays and paused days included) or is a low day from the habit's start, outside its paused
 * range and on a scheduled day. A partly done day is not kept.
 */
export function keptDays(
  habit: KeptHabit,
  days: readonly DayEntry[],
  lowDays: readonly LocalDateString[],
  today: LocalDateString,
  window: number,
): KeptDays {
  const cutoff = addDays(today, 1 - window);
  const from = windowStart(habit, today, window);
  const paused = (d: LocalDateString) =>
    habit.pausedUntil !== null && d <= habit.pausedUntil && (habit.pausedFrom === null || d >= habit.pausedFrom);
  const kept = new Set<LocalDateString>();
  for (const day of days) if (day.completed === true && day.date >= cutoff && day.date <= today) kept.add(day.date);
  for (const d of lowDays) if (d >= from && d <= today && !paused(d) && !isOffday(habit, d)) kept.add(d);
  return { kept: kept.size, span: Math.max(0, Math.min(window, daysBetween(from, today) + 1)) };
}
