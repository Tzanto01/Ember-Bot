import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';
import type { ApiClient } from '../api-client';
import { type DeviceStore, withDayEdit } from '../device-store';
import type { Habit } from '../models';
import { asApiError } from '../problem';
import { planReminders } from './reminder-plan';

/** Lock-screen text: names no habit (contract, web push rule). */
export const reminderBody = 'A gentle nudge from Ember';
const channelId = 'reminders';

const capacitorNotifications = () =>
  import('@capacitor/local-notifications').then((m) => m.LocalNotifications);

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
    private readonly notifications: () => Promise<LocalNotificationsPlugin> = capacitorNotifications,
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
    const plugin = await this.notifications();
    const status = await plugin.checkPermissions();
    return (
      status.display === 'granted' || (await plugin.requestPermissions()).display === 'granted'
    );
  }

  /** True when reminders can fire at the exact minute (Android 12+ exact alarms); else they arrive a little late. */
  async exactAllowed(): Promise<boolean> {
    return (
      (await (await this.notifications()).checkExactNotificationSetting()).exact_alarm ===
      'granted'
    );
  }

  /** Opens the system setting for exact alarms. */
  async openExactSetting(): Promise<void> {
    await (await this.notifications()).changeExactNotificationSetting();
  }

  /** Cancels every scheduled reminder and clears delivered ones (logout, account deletion). */
  async clearAll(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const plugin = await this.notifications();
        await this.cancelPending();
        await plugin.removeAllDeliveredNotifications();
      })
      .catch(() => undefined);
    return this.chain;
  }

  private async run(userId: string, timeZone: string): Promise<void> {
    let habits: Habit[];
    try {
      habits = await this.api.listHabits();
      await this.store.saveHabits({ userId, timeZone, habits }).catch(() => undefined);
    } catch (error) {
      if (asApiError(error).status === 401) return;
      const cached = await this.store.habits(userId).catch(() => null);
      if (!cached) return;
      const queued = await this.store.edits(userId).catch(() => []);
      habits = cached.habits.map((habit) =>
        queued.filter((edit) => edit.habitId === habit.id).reduce(withDayEdit, habit),
      );
    }
    const plan = planReminders(habits, timeZone, Date.now());
    const plugin = await this.notifications();
    if (!this.channelReady) {
      await plugin.createChannel({
        id: channelId,
        name: 'Reminders',
        description: 'Gentle habit reminders',
        importance: 3,
      });
      this.channelReady = true;
    }
    await this.cancelPending();
    if (!plan.length || (await plugin.checkPermissions()).display !== 'granted') return;
    await plugin.schedule({
      notifications: plan.map((reminder) => ({
        id: reminder.id,
        title: 'Ember',
        body: reminderBody,
        channelId,
        schedule: { at: new Date(reminder.at), allowWhileIdle: true },
      })),
    });
  }

  private async cancelPending(): Promise<void> {
    const plugin = await this.notifications();
    const pending = await plugin.getPending();
    if (pending.notifications.length) {
      await plugin.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
    }
  }
}
