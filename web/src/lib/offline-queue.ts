import type { DeviceStore, NoteEdit, QueuedEdit, QueueEdit } from './device-store';
import { type ApiError, asApiError } from './problem';
import { Store } from './store';

/** What happened to the queue in one replay. */
export interface ReplayResult {
  sent: number;
  dropped: number;
  remaining: number;
}

/**
 * Contract "Offline day edits": a failed replay is dropped only on 404, 422 `before_habit_start` /
 * `in_future` or 400 `validation`; everything else (consent_required, 401, 429, 5xx, network) stays queued for a
 * later try. A journal edit refused with 400 goes to {@link OfflineQueue.resealNote} instead.
 */
export function shouldDrop(error: ApiError): boolean {
  return (
    error.status === 404 ||
    (error.status === 400 && error.type === 'validation') ||
    (error.status === 422 && (error.type === 'before_habit_start' || error.type === 'in_future'))
  );
}

/**
 * What to do with a journal edit refused with 400: replay `edit` (converted to the journal's current form), `'hold'`
 * (the journal took it to replay after the next unlock), or drop it, showing `text` (null when unreadable).
 */
export type ResealResult = { edit: NoteEdit } | 'hold' | { dropText: string | null };

/** A dropped journal edit, for the gentle notice; `text` null when it was ciphertext this device can't read. */
export interface DroppedNote {
  date: string;
  text: string | null;
}

const plainText = (edit: NoteEdit): string | null =>
  edit.body && 'text' in edit.body ? (edit.body.text ?? null) : null;

/**
 * Day and journal edits made while offline, per user, replayed in order once online (shared by the PWA and the app).
 * `userId` is set by `DeviceSync` from the signed-in user.
 */
export class OfflineQueue {
  private readonly replaying = new Map<string, Promise<ReplayResult>>();

  /** The signed-in user the queue belongs to, or null. */
  readonly userId = new Store<string | null>(null);
  /** Edits waiting for the signed-in user. */
  readonly pending = new Store(0);
  /** Bumps whenever an edit is queued, so `DeviceSync` can try a replay and rebuild reminders. */
  readonly added = new Store(0);
  /** Journal edits dropped since the app started (contract "Offline day edits"), so the user can copy the text. */
  readonly droppedNotes = new Store<DroppedNote[]>([]);
  /** Set by the composition root: converts a journal edit refused with 400 (the journal changed form). */
  resealNote: ((edit: NoteEdit) => Promise<ResealResult>) | null = null;

  constructor(private readonly store: DeviceStore) {}

  /** Queues an edit for the signed-in user; false when nobody is signed in or storage is unavailable. */
  async add(edit: QueueEdit): Promise<boolean> {
    const userId = this.userId.get();
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
   * the first edit that must be kept stops the replay so the order holds. Concurrent calls share one run, and
   * edits queued while it runs are sent in the same run.
   */
  replay(userId: string, send: (edit: QueueEdit) => Promise<unknown>): Promise<ReplayResult> {
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
    if (this.userId.get() === userId) this.pending.set(0);
    this.droppedNotes.set([]);
  }

  /** Re-reads the user's queue length into `pending` (when the user is the signed-in one). */
  async refreshCount(userId: string): Promise<void> {
    const count = (await this.store.edits(userId).catch(() => [] as QueuedEdit[])).length;
    if (this.userId.get() === userId) this.pending.set(count);
  }

  private async run(
    userId: string,
    send: (edit: QueueEdit) => Promise<unknown>,
  ): Promise<ReplayResult> {
    const result: ReplayResult = { sent: 0, dropped: 0, remaining: 0 };
    const load = () => this.store.edits(userId).catch(() => [] as QueuedEdit[]);
    for (let queued = await load(); queued.length && !result.remaining; queued = await load()) {
      for (const [index, edit] of queued.entries()) {
        try {
          const { seq: _seq, userId: _user, ...sent } = edit;
          await send(sent as QueueEdit);
          result.sent++;
        } catch (error) {
          const apiError = asApiError(error);
          if (edit.kind === 'note' && apiError.status === 400) {
            const { seq: _seq, userId: _user, ...note } = edit;
            const outcome = await this.reseal(note, send);
            if (outcome === 'keep') {
              result.remaining = queued.length - index;
              break;
            }
            if (outcome === 'sent') result.sent++;
            else if (outcome === 'dropped') result.dropped++;
          } else if (!shouldDrop(apiError)) {
            result.remaining = queued.length - index;
            break;
          } else {
            result.dropped++;
          }
        }
        await this.store.deleteEdit(edit.seq);
      }
    }
    await this.refreshCount(userId);
    return result;
  }

  private async reseal(
    note: NoteEdit,
    send: (edit: QueueEdit) => Promise<unknown>,
  ): Promise<'sent' | 'held' | 'dropped' | 'keep'> {
    let outcome: ResealResult;
    try {
      outcome = this.resealNote ? await this.resealNote(note) : { dropText: plainText(note) };
    } catch {
      return 'keep';
    }
    if (outcome === 'hold') return 'held';
    if ('dropText' in outcome) return this.dropNote(note.date, outcome.dropText);
    try {
      await send(outcome.edit);
      return 'sent';
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status !== 400 && !shouldDrop(apiError)) return 'keep';
      return this.dropNote(note.date, plainText(note) ?? plainText(outcome.edit));
    }
  }

  private dropNote(date: string, text: string | null): 'dropped' {
    this.droppedNotes.update((notes) => [...notes, { date, text }]);
    return 'dropped';
  }
}
