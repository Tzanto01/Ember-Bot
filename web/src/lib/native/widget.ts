import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import type { Habit, LocalDateString } from '../models';
import { scheduledOn } from './reminder-plan';

/** A habit's state on the widget: `rest` is a low day, never "missed". */
export type WidgetHabitState = 'done' | 'partial' | 'open' | 'rest';

export interface WidgetHabit {
  id: number;
  name: string;
  state: WidgetHabitState;
  count: number;
  timesPerDay: number;
}

/** What the "Today in Ember" widget shows: today's scheduled habits (at most {@link widgetRows}) and how many more. */
export interface WidgetSnapshot {
  userId: string;
  date: LocalDateString;
  /** The account's zone, so the widget can tell when the snapshot is from an earlier day. */
  timeZone: string;
  habits: WidgetHabit[];
  more: number;
  /** Tomorrow from the schedule alone, shown after local midnight until the app pushes a fresh snapshot. */
  next?: Pick<WidgetSnapshot, 'date' | 'habits' | 'more'>;
}

/** The custom native plugin (`EmberWidget`, Android only). */
export interface EmberWidgetPlugin {
  update(snapshot: WidgetSnapshot): Promise<void>;
  clear(): Promise<void>;
  /** A tapped widget row (`habitId`, `date`, `userId`, validated natively) or `{}` for "open Today". */
  addListener(event: 'widgetTap', listener: (tap: unknown) => void): Promise<PluginListenerHandle>;
}

/** Rows the widget shows before "+N more". */
export const widgetRows = 4;

const EmberWidget = registerPlugin<EmberWidgetPlugin>('EmberWidget');

/** Loads the plugin wrapped in an object (a Capacitor proxy must never be awaited itself). */
export const capacitorWidget = async (): Promise<{ EmberWidget: EmberWidgetPlugin }> => ({ EmberWidget });

const hidden = new Set(['offday', 'beforestart', 'paused']);

/**
 * The snapshot for `date`: habits scheduled that day in list order (from `habit.today` when it is for `date`,
 * else from the schedule, as open). Names only go to the app-private widget, never to a notification.
 */
export function widgetSnapshot(
  userId: string,
  timeZone: string,
  date: LocalDateString,
  habits: Habit[],
): WidgetSnapshot {
  const shown: WidgetHabit[] = [];
  for (const habit of habits) {
    const timesPerDay = habit.timesPerDay ?? 1;
    const fresh = habit.today.date === date;
    if (fresh ? hidden.has(habit.today.state) : !scheduledOn(habit, date)) continue;
    const count = fresh ? habit.today.count : 0;
    const state: WidgetHabitState = !fresh
      ? 'open'
      : habit.today.state === 'done' || count >= timesPerDay
        ? 'done'
        : habit.today.state === 'lowday'
          ? 'rest'
          : count > 0
            ? 'partial'
            : 'open';
    shown.push({ id: habit.id, name: habit.name, state, count, timesPerDay });
  }
  return {
    userId,
    date,
    timeZone,
    habits: shown.slice(0, widgetRows),
    more: Math.max(0, shown.length - widgetRows),
  };
}
