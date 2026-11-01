import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../api-client';
import { DeviceStore } from '../device-store';
import { Habit } from '../models';
import { planReminders } from './reminder-plan';

/** Lock-screen text: names no habit (contract, web push rule). */
export const reminderBody = 'A gentle nudge from Ember';
const channelId = 'reminders';

const notifications = () =>
  import('@capacitor/local-notifications').then((m) => m.LocalNotifications);

/**
 * Native build only: keeps the device's local reminder notifications in step with the habits that have the
 * `mobile` channel, so they fire offline. Each rebuild replaces every pending notification with a fresh plan.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly api = inject(ApiClient);
  private readonly store = inject(DeviceStore);
  private chain: Promise<void> = Promise.resolve();
  private channelReady = false;

  /**
   * Rebuilds the user's reminders from the current habit list (cached when offline), in `timeZone`.
   * Rebuilds run one after another. Never throws.
   */
  rebuild(userId: string, timeZone: string): Promise<void> {
    this.chain = this.chain.then(() => this.run(userId, timeZone)).catch(() => undefined);
    return this.chain;
  }

  /** Asks for the notification permission (Android 13+ `POST_NOTIFICATIONS`); true when granted. */
  async requestPermission(): Promise<boolean> {
    const plugin = await notifications();
    const status = await plugin.checkPermissions();
    return (
      status.display === 'granted' || (await plugin.requestPermissions()).display === 'granted'
    );
  }

  /** True when reminders can fire at the exact minute (Android 12+ exact alarms); else they arrive a little late. */
  async exactAllowed(): Promise<boolean> {
    return (
      (await (await notifications()).checkExactNotificationSetting()).exact_alarm === 'granted'
    );
  }

  /** Opens the system setting for exact alarms. */
  async openExactSetting(): Promise<void> {
    await (await notifications()).changeExactNotificationSetting();
  }

  /** Cancels every scheduled reminder and clears delivered ones (logout, account deletion). */
  async clearAll(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        const plugin = await notifications();
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
    } catch {
      const cached = await this.store.habits(userId).catch(() => null);
      if (!cached) return;
      habits = cached.habits;
    }
    const plan = planReminders(habits, timeZone, Date.now());
    const plugin = await notifications();
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
    const plugin = await notifications();
    const pending = await plugin.getPending();
    if (pending.notifications.length) {
      await plugin.cancel({ notifications: pending.notifications.map(({ id }) => ({ id })) });
    }
  }
}
