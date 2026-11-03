import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import type { ApiClient } from '../api-client';
import { type DeviceStore, withDayEdit } from '../device-store';
import { addDays, isLocalDate } from '../local-date';
import type { Habit, LocalDateString, Routine } from '../models';
import type { OfflineQueue } from '../offline-queue';
import { asApiError } from '../problem';
import { notificationColor } from '../theme';
import { reminderNames } from './reminder-names';
import { localDate, planReminders } from './reminder-plan';
import { capacitorWidget, type EmberWidgetPlugin, widgetSnapshot } from './widget';

/** Lock-screen text: names no habit (contract, web push rule). */
export const reminderBody = 'A gentle nudge from Ember';
/** The notification action type carrying the "Done" button (single-habit reminders, names on). */
export const doneActionType = 'ember-done';
/** The `actionId` of the "Done" button. */
export const doneAction = 'done';
const channelId = 'reminders';
const issuedKey = 'ember.reminderIssued';

interface Issued {
  id: number;
  userId: string;
  habitId: number;
  date: LocalDateString;
}

function readIssued(): Issued[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(issuedKey) ?? '[]');
    return Array.isArray(value) ? (value as Issued[]) : [];
  } catch {
    return [];
  }
}

function unreachable(error: unknown): boolean {
  const apiError = asApiError(error);
  return apiError.status === 0 || (apiError.status === 504 && !apiError.problem);
}

const capacitorNotifications = () => import('@capacitor/local-notifications');

/** A validated check-in target from a notification `extra` or a widget tap. */
export interface CheckInTarget {
  habitId: number;
  date: LocalDateString;
}

/**
 * `extra` as a check-in for `userId`: a string `userId` equal to it, a positive integer `habitId` and a real
 * `yyyy-MM-dd` `date`; anything else (other user, routine reminder, malformed) is null.
 */
export function checkInTarget(extra: unknown, userId: string): CheckInTarget | null {
  if (typeof extra !== 'object' || extra === null) return null;
  const { userId: owner, habitId, date } = extra as Record<string, unknown>;
  if (typeof owner !== 'string' || owner !== userId) return null;
  if (typeof habitId !== 'number' || !Number.isSafeInteger(habitId) || habitId <= 0) return null;
  if (typeof date !== 'string' || !isLocalDate(date)) return null;
  return { habitId, date };
}

/**
 * Native build only: keeps the device's local reminder notifications in step with the habits that have the
 * `mobile` channel, so they fire offline. Each rebuild replaces every pending notification with a fresh plan.
 */
export class Reminders {
  private chain: Promise<void> = Promise.resolve();
  private channelReady = false;

  constructor(
    private readonly api: ApiClient,
    private readonly store: DeviceStore,
    private readonly notifications: () => Promise<{ LocalNotifications: LocalNotificationsPlugin }> = capacitorNotifications,
    private readonly widget: () => Promise<{ EmberWidget: EmberWidgetPlugin }> = capacitorWidget,
  ) {}

  /**
   * Rebuilds the user's reminders from the current habit list (when offline: the cached list with the queued
   * day edits applied, so an offline check-in still cancels today's reminder), in `timeZone`.
   * Rebuilds run one after another. Never throws.
   */
  rebuild(userId: string, timeZone: string): Promise<void> {
    this.chain = this.chain.then(() => this.run(userId, timeZone)).catch(() => undefined);
    return this.chain;
  }

  /** Asks for the notification permission (Android 13+ `POST_NOTIFICATIONS`); true when granted. */
  async requestPermission(): Promise<boolean> {
    const plugin = (await this.notifications()).LocalNotifications;
    const status = await plugin.checkPermissions();
    return (
      status.display === 'granted' || (await plugin.requestPermissions()).display === 'granted'
    );
  }

  /** True when reminders can fire at the exact minute (Android 12+ exact alarms); else they arrive a little late. */
  async exactAllowed(): Promise<boolean> {
    return (
      (await (await this.notifications()).LocalNotifications.checkExactNotificationSetting()).exact_alarm ===
      'granted'
    );
  }

  /** Opens the system setting for exact alarms. */
  async openExactSetting(): Promise<void> {
    await (await this.notifications()).LocalNotifications.changeExactNotificationSetting();
  }

  /**
   * Cancels every scheduled reminder, clears delivered ones and the widget, and resets "Show habit names in
   * reminders" (sign-out, session end, account deletion).
   */
  async clearAll(): Promise<void> {
    reminderNames.set(false);
    localStorage.removeItem(issuedKey);
    this.chain = this.chain
      .then(async () => {
        await this.toWidget((widget) => widget.clear());
        const plugin = (await this.notifications()).LocalNotifications;
        await this.cancelPending();
        await plugin.removeAllDeliveredNotifications();
      })
      .catch(() => undefined);
    return this.chain;
  }

  /**
   * True when this app scheduled a notification with "Done" under `id` carrying exactly `extra` (recent days),
   * so a notification action forged by another app through the exported activity is not acted on.
   */
  wasIssued(id: unknown, extra: unknown): boolean {
    if (typeof extra !== 'object' || extra === null) return false;
    const { userId, habitId, date } = extra as Record<string, unknown>;
    return readIssued().some(
      (issued) =>
        issued.id === id &&
        issued.userId === userId &&
        issued.habitId === habitId &&
        issued.date === date,
    );
  }

  /**
   * "Done" from a reminder or a widget tap: when `extra` is a valid {@link checkInTarget} for `userId` and names a
   * habit the app knows (live list, or offline the cached one with queued edits), adds one to that day's count
   * (capped at `timesPerDay`) with the absolute `PUT { count }`, queued in `queue` when the API is unreachable, and
   * resolves with the habit's name; anything stale, foreign or unreadable resolves null and writes nothing.
   */
  async checkIn(
    userId: string,
    timeZone: string,
    extra: unknown,
    queue: OfflineQueue,
  ): Promise<string | null> {
    const target = checkInTarget(extra, userId);
    if (!target) return null;
    try {
      const habit = (await this.load(userId, timeZone))?.habits.find(
        ({ id }) => id === target.habitId,
      );
      if (!habit) return null;
      const count =
        habit.today.date === target.date
          ? habit.today.count
          : ((await this.api.getDays(habit.id, target.date, target.date))[0]?.count ?? 0);
      const timesPerDay = habit.timesPerDay ?? 1;
      if (count < timesPerDay) {
        const edit = { habitId: habit.id, date: target.date, completed: null, count: count + 1 };
        await this.api
          .setDayCount(edit.habitId, edit.date, edit.count)
          .catch(async (error: unknown) => {
            if (!unreachable(error) || !(await queue.add(edit))) throw error;
          });
      }
      return habit.name;
    } catch {
      return null;
    }
  }

  private async load(
    userId: string,
    timeZone: string,
  ): Promise<{ habits: Habit[]; routines: Routine[] } | null> {
    try {
      const habits = await this.api.listHabits();
      const routines = await this.api
        .listRoutines()
        .catch(async () => (await this.store.habits(userId).catch(() => null))?.routines);
      await this.store.saveHabits({ userId, timeZone, habits, routines }).catch(() => undefined);
      return { habits, routines: routines ?? [] };
    } catch (error) {
      if (asApiError(error).status === 401) return null;
      const cached = await this.store.habits(userId).catch(() => null);
      if (!cached) return null;
      const queued = await this.store.edits(userId).catch(() => []);
      return {
        habits: cached.habits.map((habit) => queued.reduce(withDayEdit, habit)),
        routines: cached.routines ?? [],
      };
    }
  }

  private async run(userId: string, timeZone: string): Promise<void> {
    const loaded = await this.load(userId, timeZone);
    if (!loaded) return;
    const { habits, routines } = loaded;
    const now = Date.now();
    const today = localDate(now, timeZone);
    await this.toWidget((widget) => widget.update(widgetSnapshot(userId, timeZone, today, habits)));
    const plan = planReminders(habits, timeZone, now, routines);
    const plugin = (await this.notifications()).LocalNotifications;
    const names = reminderNames.get();
    if (!this.channelReady) {
      await plugin.createChannel({
        id: channelId,
        name: 'Reminders',
        description: 'Gentle habit reminders',
        importance: 3,
      });
      await plugin.registerActionTypes({
        types: [
          { id: doneActionType, actions: [{ id: doneAction, title: 'Done', foreground: true }] },
        ],
      });
      this.channelReady = true;
    }
    await this.cancelPending();
    if (!plan.length || (await plugin.checkPermissions()).display !== 'granted') return;
    const iconColor = notificationColor();
    const habitName = new Map(habits.map((habit) => [habit.id, habit.name]));
    const routineName = new Map(routines.map((routine) => [routine.id, routine.name]));
    const notifications = plan.map((reminder) => {
      const name =
        reminder.habitId !== undefined
          ? habitName.get(reminder.habitId)
          : routineName.get(reminder.routineId ?? 0);
      const named = names && !!name;
      return {
        id: reminder.id,
        title: named ? name : 'Ember',
        body: reminderBody,
        channelId,
        iconColor,
        actionTypeId: named && reminder.habitId !== undefined ? doneActionType : undefined,
        extra:
          reminder.habitId !== undefined
            ? { userId, habitId: reminder.habitId, date: reminder.date }
            : { userId, routineId: reminder.routineId, date: reminder.date },
        schedule: { at: new Date(reminder.at), allowWhileIdle: true },
      };
    });
    const recent = addDays(today, -2);
    const issued = new Map<string, Issued>();
    for (const entry of [
      ...readIssued().filter((entry) => entry.date >= recent && entry.date <= today),
      ...notifications
        .filter((n) => n.actionTypeId)
        .map((n) => ({ id: n.id, ...(n.extra as Omit<Issued, 'id'>) })),
    ]) {
      issued.set(`${entry.id}|${entry.userId}|${entry.habitId}|${entry.date}`, entry);
    }
    try {
      localStorage.setItem(issuedKey, JSON.stringify([...issued.values()]));
    } catch {
      localStorage.removeItem(issuedKey);
    }
    await plugin.schedule({ notifications });
  }

  private toWidget(call: (widget: EmberWidgetPlugin) => Promise<void>): Promise<void> {
    return this.widget()
      .then(({ EmberWidget }) => call(EmberWidget))
      .catch(() => undefined);
  }

  private async cancelPending(): Promise<void> {
    const plugin = (await this.notifications()).LocalNotifications;
    const pending = await plugin.getPending();
    if (pending.notifications.length) {
      await plugin.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
    }
  }
}
