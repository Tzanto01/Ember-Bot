import { HttpContextToken } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { DayEdit, DeviceStore, QueuedEdit } from './device-store';
import { ApiError, asApiError } from './problem';

/** What happened to the queue in one replay. */
export interface ReplayResult {
  sent: number;
  dropped: number;
  remaining: number;
}

/** Marks a replayed day edit, so it doesn't trigger a reminder rebuild of its own (the replay ends with one). */
export const REPLAY = new HttpContextToken(() => false);

/**
 * Contract "Offline day edits": a failed replay is dropped only on 404 or 422 `before_habit_start` /
 * `in_future`; everything else (consent_required, 401, 429, 5xx, network) stays queued for a later try.
 */
export function shouldDrop(error: ApiError): boolean {
  return (
    error.status === 404 ||
    (error.status === 422 && (error.type === 'before_habit_start' || error.type === 'in_future'))
  );
}

/**
 * Day edits made while offline, per user, replayed in order once online (shared by the PWA and the app).
 * `userId` is set by `DeviceSync` from the signed-in user.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueue {
  private readonly store = inject(DeviceStore);
  private readonly replaying = new Map<string, Promise<ReplayResult>>();

  /** The signed-in user the queue belongs to, or null. */
  readonly userId = signal<string | null>(null);
  /** Edits waiting for the signed-in user. */
  readonly pending = signal(0);
  /** Bumps whenever an edit is queued, so `DeviceSync` can try a replay and rebuild reminders. */
  readonly added = signal(0);

  /** Queues an edit for the signed-in user; false when nobody is signed in or storage is unavailable. */
  async add(edit: DayEdit): Promise<boolean> {
    const userId = this.userId();
    if (!userId) return false;
    try {
      await this.store.addEdit(userId, edit);
      await this.refreshCount(userId);
      this.added.update((count) => count + 1);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sends the user's queued edits oldest first, one at a time. A sent or dropped edit leaves the queue;
   * the first edit that must be kept stops the replay so the order holds. Concurrent calls share one run.
   */
  replay(userId: string, send: (edit: DayEdit) => Promise<unknown>): Promise<ReplayResult> {
    let run = this.replaying.get(userId);
    if (!run) {
      run = this.run(userId, send).finally(() => this.replaying.delete(userId));
      this.replaying.set(userId, run);
    }
    return run;
  }

  /** Forgets everything queued and cached for the user. */
  async clear(userId: string): Promise<void> {
    await this.store.clearUser(userId).catch(() => undefined);
    if (this.userId() === userId) this.pending.set(0);
  }

  async refreshCount(userId: string): Promise<void> {
    const count = (await this.store.edits(userId).catch(() => [] as QueuedEdit[])).length;
    if (this.userId() === userId) this.pending.set(count);
  }

  private async run(
    userId: string,
    send: (edit: DayEdit) => Promise<unknown>,
  ): Promise<ReplayResult> {
    const result: ReplayResult = { sent: 0, dropped: 0, remaining: 0 };
    const queued = await this.store.edits(userId).catch(() => [] as QueuedEdit[]);
    for (const [index, edit] of queued.entries()) {
      try {
        await send({ habitId: edit.habitId, date: edit.date, completed: edit.completed });
        result.sent++;
      } catch (error) {
        if (!shouldDrop(asApiError(error))) {
          result.remaining = queued.length - index;
          break;
        }
        result.dropped++;
      }
      await this.store.deleteEdit(edit.seq);
    }
    await this.refreshCount(userId);
    return result;
  }
}
