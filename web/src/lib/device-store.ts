import type { DayNoteBody, DayState, Habit, Routine } from './models';

/**
 * One day edit made while offline: `completed` null means "clear the day"; `count` (v1.6) sends the absolute
 * `PUT { count }` instead and wins over `completed`. Entries stored before v1.6 have no `kind`.
 */
export interface DayEdit {
  kind?: 'day';
  habitId: number;
  date: string;
  completed: boolean | null;
  count?: number;
}

/** One journal edit made while offline (v1.6): `body` null deletes the day's note. Encrypted already when private. */
export interface NoteEdit {
  kind: 'note';
  date: string;
  body: DayNoteBody | null;
}

/** Anything the offline queue replays. */
export type QueueEdit = DayEdit | NoteEdit;

/** A queued {@link QueueEdit}, keyed by the user who made it; `seq` keeps the replay order. */
export type QueuedEdit = QueueEdit & {
  seq: number;
  userId: string;
};

/** True for a habit day edit (including entries queued before v1.6). */
export function isDayEdit(edit: QueueEdit): edit is DayEdit {
  return edit.kind !== 'note';
}

/** The day state a count reaches: done at `timesPerDay`, partial below it, pending at zero. */
export function stateForCount(count: number, timesPerDay: number): DayState {
  return count >= timesPerDay ? 'done' : count > 0 ? 'partial' : 'pending';
}

/** The habit list last seen for a user, so the app can schedule reminders while offline. */
export interface CachedHabits {
  userId: string;
  timeZone: string;
  habits: Habit[];
  /** The user's routines (v1.6); missing in entries cached before. */
  routines?: Routine[];
}

/** The habit with `edit` applied to its `today` entry when the edit is for that day (optimistic view). */
export function withDayEdit(habit: Habit, edit: QueueEdit): Habit {
  if (!isDayEdit(edit) || edit.habitId !== habit.id || habit.today.date !== edit.date) return habit;
  const target = habit.timesPerDay ?? 1;
  const resting = habit.today.state === 'offday' || habit.today.state === 'lowday' ? habit.today.state : null;
  if (edit.count !== undefined) {
    const state = edit.count === 0 && resting ? resting : stateForCount(edit.count, target);
    const completed = state === 'done' ? true : null;
    return { ...habit, today: { date: edit.date, state, completed, count: edit.count } };
  }
  const state =
    edit.completed === true ? 'done' : edit.completed === false ? 'notdone' : (resting ?? 'pending');
  const count = edit.completed === true ? target : 0;
  return { ...habit, today: { date: edit.date, state, completed: edit.completed, count } };
}

const dbName = 'ember-device';
const edits = 'edits';
const cache = 'cache';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The device's IndexedDB: queued offline day edits (per user, in order) and the cached habit list.
 * Everything here belongs to one user and is wiped on logout and account deletion.
 */
export class DeviceStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const queue = request.result.createObjectStore(edits, {
          keyPath: 'seq',
          autoIncrement: true,
        });
        queue.createIndex('userId', 'userId');
        request.result.createObjectStore(cache, { keyPath: 'userId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }

  private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  /** Appends an edit to the user's queue. */
  async addEdit(userId: string, edit: QueueEdit): Promise<void> {
    await done((await this.store(edits, 'readwrite')).add({ ...edit, userId }));
  }

  /** The user's queued edits, oldest first. */
  async edits(userId: string): Promise<QueuedEdit[]> {
    const all = await done((await this.store(edits, 'readonly')).index('userId').getAll(userId));
    return (all as QueuedEdit[]).sort((a, b) => a.seq - b.seq);
  }

  async deleteEdit(seq: number): Promise<void> {
    await done((await this.store(edits, 'readwrite')).delete(seq));
  }

  async saveHabits(entry: CachedHabits): Promise<void> {
    await done((await this.store(cache, 'readwrite')).put(entry));
  }

  async habits(userId: string): Promise<CachedHabits | null> {
    return (
      ((await done((await this.store(cache, 'readonly')).get(userId))) as
        CachedHabits | undefined) ?? null
    );
  }

  /** Removes the user's queued edits and cached habits. */
  async clearUser(userId: string): Promise<void> {
    const queue = await this.store(edits, 'readwrite');
    const keys = await done(queue.index('userId').getAllKeys(userId));
    await Promise.all(keys.map((key) => done(queue.delete(key))));
    await done((await this.store(cache, 'readwrite')).delete(userId));
  }
}
