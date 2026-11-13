import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import type { ApiClient } from '../api-client';
import { type DeviceStore, withDayEdit } from '../device-store';
import { currentLanguage, t } from '../i18n';
import { addDays, isLocalDate } from '../local-date';
import { localModeOn } from '../local/mode';
import type { Habit, LocalDateString, ReminderDestination, Routine } from '../models';
import type { OfflineQueue } from '../offline-queue';
import { asApiError } from '../problem';
import { notificationColor } from '../theme';
import { reminderNames } from './reminder-names';
import { cachedPhone, forgetPhone, installId, phoneLabel, type ReminderPhone, rememberPhone } from './phone';
import { localDate, planReminders, type ReminderTarget } from './reminder-plan';
import { updaterAvailable } from './updater';
import { capacitorWidget, type EmberWidgetPlugin, widgetSnapshot } from './widget';

/** Lock-screen text: names no habit (contract, web push rule). */
export const reminderBody = () => t('reminders.body');
/** Body of the second reminder (contract v1.8). */
export const secondReminderBody = () => t('reminders.secondBody');
/** The notification action type carrying the "Done" button (single-habit reminders, with or without names). */
export const doneActionType = 'ember-done';
/** The `actionId` of the "Done" button. */
export const doneAction = 'done';
const channelId = 'reminders';
const issuedKey = 'ember.reminderIssued';
const plannedKey = 'ember.reminderPlanned';
const exactAskedKey = 'ember.exactAlarmAsked';

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

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
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
 * Native build only: keeps the device's local reminder notifications in step with the habits and routines that
 * remind on this phone ({@link ReminderTarget}: in no-account mode the `mobile` channel; with an account this
 * phone's destination, registered on every online rebuild while notifications are allowed and cached for offline
 * ones), so they fire offline. A rebuild whose plan differs from the last scheduled one replaces every
 * pending notification with it; an unchanged plan leaves them alone.
 */
export class Reminders {
  private chain: Promise<void> = Promise.resolve();
  private channelLanguage: string | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly store: DeviceStore,
    private readonly notifications: () => Promise<{ LocalNotifications: LocalNotificationsPlugin }> = capacitorNotifications,
    private readonly widget: () => Promise<{ EmberWidget: EmberWidgetPlugin }> = capacitorWidget,
    private readonly exactAlarms: () => boolean = updaterAvailable,
  ) {}

  /**
   * Rebuilds the user's reminders from the current habit list (when offline: the cached list with the queued
   * day edits applied, so an offline check-in still cancels today's reminder), in `timeZone`, with a second
   * reminder `secondMinutes` after each one when above 0. Rebuilds run one after another. Never throws.
   */
  rebuild(userId: string, timeZone: string, secondMinutes = 0): Promise<void> {
    this.chain = this.chain.then(() => this.run(userId, timeZone, secondMinutes)).catch(() => undefined);
    return this.chain;
  }

  /**
   * Asks for the notification permission (Android 13+ `POST_NOTIFICATIONS`); true when granted. In the beta app,
   * once granted, also opens the "Alarms & reminders" setting once per install so reminders can fire on time.
   */
  async requestPermission(): Promise<boolean> {
    const plugin = (await this.notifications()).LocalNotifications;
    const status = await plugin.checkPermissions();
    const granted =
      status.display === 'granted' || (await plugin.requestPermissions()).display === 'granted';
    if (granted && this.exactAlarms() && !localStorage.getItem(exactAskedKey)) {
      localStorage.setItem(exactAskedKey, '1');
      if (!(await this.exactAllowed())) await this.allowExact();
    }
    return granted;
  }

  /**
   * Settings "This phone" (account mode): asks for the notification permission ({@link requestPermission}), then
   * registers this phone and turns its destination on. Resolves with the destination, or null when the permission
   * was refused; rejects with the API error when the server refuses or can't be reached. Rebuild the reminders
   * afterwards.
   */
  async enablePhone(): Promise<ReminderDestination | null> {
    if (!(await this.requestPermission())) return null;
    let destination = await this.api.registerPhone(installId(), phoneLabel());
    if (!destination.enabled) destination = await this.api.setReminderDestination(destination.id, true);
    rememberPhone(destination);
    return destination;
  }

  /**
   * Cancels every scheduled reminder, clears delivered ones and the widget, forgets this phone's cached destination
   * and resets "Show habit names in reminders" (sign-out, session end, account deletion).
   */
  async clearAll(): Promise<void> {
    reminderNames.set(false);
    forgetPhone();
    localStorage.removeItem(issuedKey);
    localStorage.removeItem(plannedKey);
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
  ): Promise<{ habits: Habit[]; routines: Routine[]; live: boolean } | null> {
    try {
      const habits = await this.api.listHabits();
      const routines = await this.api
        .listRoutines()
        .catch(async () => (await this.store.habits(userId).catch(() => null))?.routines);
      await this.store.saveHabits({ userId, timeZone, habits, routines }).catch(() => undefined);
      return { habits, routines: routines ?? [], live: true };
    } catch (error) {
      if (asApiError(error).status === 401) return null;
      const cached = await this.store.habits(userId).catch(() => null);
      if (!cached) return null;
      const queued = await this.store.edits(userId).catch(() => []);
      return {
        habits: cached.habits.map((habit) => queued.reduce(withDayEdit, habit)),
        routines: cached.routines ?? [],
        live: false,
      };
    }
  }

  private async run(userId: string, timeZone: string, secondMinutes: number): Promise<void> {
    const loaded = await this.load(userId, timeZone);
    if (!loaded) return;
    const { habits, routines, live } = loaded;
    const now = Date.now();
    const today = localDate(now, timeZone);
    const next = widgetSnapshot(userId, timeZone, addDays(today, 1), habits);
    await this.toWidget((widget) =>
      widget.update({
        ...widgetSnapshot(userId, timeZone, today, habits),
        next: { date: next.date, habits: next.habits, more: next.more },
      }),
    );
    const plugin = (await this.notifications()).LocalNotifications;
    const target: ReminderTarget = localModeOn()
      ? { mode: 'local' }
      : {
          mode: 'account',
          phone: await this.phone(
            plugin,
            live,
            () =>
              planReminders(habits, timeZone, now, routines, 0, {
                mode: 'account',
                phone: { id: '', enabled: true },
              }).length > 0,
          ),
        };
    const plan = planReminders(habits, timeZone, now, routines, secondMinutes, target);
    const names = reminderNames.get();
    const language = currentLanguage();
    if (this.channelLanguage !== language) {
      await plugin.createChannel({
        id: channelId,
        name: t('reminders.channelName'),
        description: t('reminders.channelDescription'),
        importance: 3,
      });
      await plugin.registerActionTypes({
        types: [
          { id: doneActionType, actions: [{ id: doneAction, title: t('reminders.done'), foreground: true }] },
        ],
      });
      this.channelLanguage = language;
    }
    if (!plan.length || !(await this.allowed(plugin))) {
      localStorage.removeItem(plannedKey);
      await this.cancelPending();
      return;
    }
    const iconColor = notificationColor();
    const exact = await this.exactAllowed();
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
        body: reminder.second ? secondReminderBody() : reminderBody(),
        channelId,
        iconColor,
        actionTypeId: reminder.habitId !== undefined ? doneActionType : undefined,
        extra:
          reminder.habitId !== undefined
            ? { userId, habitId: reminder.habitId, date: reminder.date }
            : { userId, routineId: reminder.routineId, date: reminder.date },
        schedule: { at: new Date(reminder.at), allowWhileIdle: true },
        isExactNotification: exact,
      };
    });
    const planned = await digest(notifications);
    if (localStorage.getItem(plannedKey) === planned) return;
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
    localStorage.removeItem(plannedKey);
    await this.cancelPending();
    await plugin.schedule({ notifications });
    try {
      localStorage.setItem(plannedKey, planned);
    } catch {}
  }

  /**
   * This phone's destination for an account-mode plan. Online and with notifications allowed (asked first while
   * Android has never asked and `wanted` says reminders would be planned), registers this phone and caches the
   * answer; otherwise, or when registering fails, the cached one (null when never registered).
   */
  private async phone(
    plugin: LocalNotificationsPlugin,
    live: boolean,
    wanted: () => boolean,
  ): Promise<ReminderPhone | null> {
    if (!live) return cachedPhone();
    const { display } = await plugin.checkPermissions();
    const granted =
      display === 'granted' ||
      (display === 'prompt' && wanted() && (await plugin.requestPermissions()).display === 'granted');
    if (!granted) return cachedPhone();
    try {
      return rememberPhone(await this.api.registerPhone(installId(), phoneLabel()));
    } catch {
      return cachedPhone();
    }
  }

  /** True when notifications may show; asks once while Android has never asked (a new phone or a reinstall). */
  private async allowed(plugin: LocalNotificationsPlugin): Promise<boolean> {
    const { display } = await plugin.checkPermissions();
    if (display === 'prompt') return (await plugin.requestPermissions()).display === 'granted';
    return display === 'granted';
  }

  /** True when Android lets Ember schedule exact alarms (Android 12+ "Alarms & reminders"; always below 12). */
  async exactAllowed(): Promise<boolean> {
    const plugin = (await this.notifications()).LocalNotifications;
    const status = await plugin.checkExactNotificationSetting().catch(() => null);
    return status?.exact_alarm === 'granted';
  }

  /** Opens Android's "Alarms & reminders" setting for Ember; true when exact alarms are allowed afterwards. */
  async allowExact(): Promise<boolean> {
    const plugin = (await this.notifications()).LocalNotifications;
    const status = await plugin.changeExactNotificationSetting().catch(() => null);
    return status?.exact_alarm === 'granted';
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
