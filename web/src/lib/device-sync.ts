import type { ApiClient } from './api-client';
import type { AuthService } from './auth';
import { isDayEdit } from './device-store';
import { reminderNames } from './native/reminder-names';
import { doneAction, type Reminders } from './native/reminders';
import { capacitorWidget } from './native/widget';
import { browserTimeZone } from './local-date';
import { navigate } from './navigation';
import type { OfflineQueue } from './offline-queue';
import { Store } from './store';
import { themeApplied } from './theme';

/**
 * Keeps the device in step with the account: replays queued offline day edits when the user is known, when an
 * edit is queued, when the browser comes back online and (native) when the app resumes; in the native build
 * (`reminders` set) it also re-reads `me` on resume and rebuilds the local reminders after every sync and
 * whenever `me` holds a new time zone or the theme changes (the reminder icon follows its colour). When a user
 * is known whose zone was never set, it sends the device's zone (not UTC) once per user on this device (a failure
 * waits for the next app start). Native "Done" taps on a reminder this app issued ({@link Reminders.wasIssued})
 * and widget row taps check in through {@link Reminders.checkIn} and open Today.
 */
export class DeviceSync {
  private userId: string | null = null;
  private timeZone: string | null = null;

  /** Bumps after a replay sent or dropped something, so screens can reload. */
  readonly synced = new Store(0);
  /** Queued edits dropped since the app started (404 or a day outside the editable range). */
  readonly dropped = new Store(0);
  /** The habit just checked in from a reminder or the widget (native), for a short confirmation; null when none. */
  readonly nativeCheckIn = new Store<{ name: string } | null>(null);

  constructor(
    private readonly auth: AuthService,
    private readonly api: ApiClient,
    private readonly queue: OfflineQueue,
    private readonly reminders: Reminders | null,
  ) {
    auth.me.subscribe(() => this.follow());
    queue.added.subscribe(() => void this.sync());
    if (reminders) {
      themeApplied.subscribe(() => this.rebuildReminders());
      reminderNames.subscribe(() => this.rebuildReminders());
    }
    this.follow();
  }

  /** Registers the online listener and, in the native build, the resume and notification-tap listeners. */
  start(): void {
    window.addEventListener('online', () => void this.sync());
    if (this.reminders) void this.listenNative();
  }

  /** Replays the signed-in user's queue, then (native) rebuilds the reminders. Never throws. */
  async sync(): Promise<void> {
    const me = this.auth.me.get();
    if (!me) return;
    const result = await this.queue
      .replay(me.id, (edit) =>
        isDayEdit(edit) ? this.api.sendDayEdit(edit, true) : this.api.sendNoteEdit(edit, true),
      )
      .catch(() => null);
    if (result?.dropped) this.dropped.update((count) => count + result.dropped);
    if (result && (result.sent || result.dropped)) this.synced.update((count) => count + 1);
    this.rebuildReminders();
  }

  /** Native build only: rebuilds the local reminders for the signed-in user. */
  rebuildReminders(): void {
    const me = this.auth.me.get();
    if (this.reminders && me) void this.reminders.rebuild(me.id, me.timezone);
  }

  private follow(): void {
    const me = this.auth.me.get();
    const id = me?.id ?? null;
    if (id !== this.userId) {
      this.userId = id;
      this.queue.userId.set(id);
      if (id) void this.queue.refreshCount(id).then(() => this.sync());
      if (id && !me?.timezoneSet) void this.claimTimeZone(id);
    }
    const timeZone = me?.timezone ?? null;
    if (timeZone !== this.timeZone) {
      this.timeZone = timeZone;
      this.rebuildReminders();
    }
  }

  private async claimTimeZone(id: string): Promise<void> {
    const timezone = browserTimeZone();
    const claimed = `ember.tzClaimed.${id}`;
    if (!timezone || timezone === 'UTC' || timezone === 'Etc/UTC' || localStorage.getItem(claimed)) return;
    const me = await this.api.updateMe({ timezone }).catch(() => null);
    if (!me) return;
    localStorage.setItem(claimed, '1');
    if (this.auth.me.get()?.id === id) this.auth.setMe(me);
  }

  private async listenNative(): Promise<void> {
    const { App } = await import('@capacitor/app');
    await App.addListener('resume', async () => {
      await this.auth.loadMe(true).catch(() => null);
      await this.sync();
    });
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const { id, extra } = event.notification;
      const done = event.actionId === doneAction && !!this.reminders?.wasIssued(id, extra);
      void this.checkIn(done ? extra : null);
    });
    const { EmberWidget } = await capacitorWidget();
    await EmberWidget.addListener('widgetTap', (tap) => void this.checkIn(tap));
  }

  /** Checks in `extra` (validated by {@link Reminders.checkIn}) for the signed-in user, then opens Today. */
  private async checkIn(extra: unknown): Promise<void> {
    const me = this.auth.me.get() ?? (await this.auth.loadMe().catch(() => null));
    const name = me && extra ? await this.reminders?.checkIn(me.id, me.timezone, extra, this.queue) : null;
    navigate('/today');
    if (name) this.nativeCheckIn.set({ name });
  }
}
