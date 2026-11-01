import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { computed, effect, Injectable, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiClient } from './api-client';
import { AuthService } from './auth.service';
import { ReminderService } from './native/reminder.service';
import { OfflineQueue, REPLAY } from './offline-queue';

/**
 * Keeps the device in step with the account: replays queued offline day edits when the user is known, when
 * the browser comes back online and (native) when the app resumes; in the native build it also re-reads `me`
 * on resume and rebuilds the local reminders after every sync.
 */
@Injectable({ providedIn: 'root' })
export class DeviceSync {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClient);
  private readonly queue = inject(OfflineQueue);
  private readonly reminders = inject(ReminderService);
  private readonly router = inject(Router);
  private readonly userId = computed(() => this.auth.me()?.id ?? null);
  private readonly timeZone = computed(() => this.auth.me()?.timezone ?? null);

  /** Bumps after a replay sent or dropped something, so screens can reload. */
  readonly synced = signal(0);
  /** Queued edits dropped since the app started (404 or a day outside the editable range). */
  readonly dropped = signal(0);

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this.queue.userId.set(id);
        if (id) void this.queue.refreshCount(id).then(() => this.sync());
      });
    });
    effect(() => {
      this.timeZone();
      untracked(() => this.rebuildReminders());
    });
    effect(() => {
      if (this.queue.added()) untracked(() => void this.sync());
    });
  }

  /** Registers the online listener and, in the native build, the resume and notification-tap listeners. */
  start(): void {
    window.addEventListener('online', () => void this.sync());
    if (environment.native) void this.listenNative();
  }

  /** Replays the signed-in user's queue, then (native) rebuilds the reminders. Never throws. */
  async sync(): Promise<void> {
    const me = this.auth.me();
    if (!me) return;
    const result = await this.queue
      .replay(me.id, (edit) => this.api.sendDayEdit(edit, true))
      .catch(() => null);
    if (result?.dropped) this.dropped.update((count) => count + result.dropped);
    if (result && (result.sent || result.dropped)) this.synced.update((count) => count + 1);
    this.rebuildReminders();
  }

  /** Native build only: rebuilds the local reminders for the signed-in user. */
  rebuildReminders(): void {
    const me = this.auth.me();
    if (environment.native && me) void this.reminders.rebuild(me.id, me.timezone);
  }

  private async listenNative(): Promise<void> {
    const { App } = await import('@capacitor/app');
    await App.addListener('resume', async () => {
      await this.auth.loadMe(true).catch(() => null);
      await this.sync();
    });
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      void this.router.navigateByUrl('/today');
    });
  }
}

const reminderInputs = /\/api\/habits(\/|\?|$)/;

/**
 * Native build only: after a successful change to habits, days or pauses, rebuilds the local reminders
 * (check-in cancels today's, edits and pauses reschedule). A timezone change rebuilds from `DeviceSync`'s
 * effect once `me` holds the new zone; replayed edits wait for the replay's single rebuild.
 */
export const reminderTriggerInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method === 'GET' || !reminderInputs.test(req.url) || req.context.get(REPLAY)) return next(req);
  const sync = inject(DeviceSync);
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) sync.rebuildReminders();
    }),
  );
};
