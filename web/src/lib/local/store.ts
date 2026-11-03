import type { LocalData } from './types';

const dbName = 'ember-local';
const storeName = 'data';
const key = 'data';

/**
 * No-account mode's device data: the whole {@link LocalData} as one IndexedDB record (database `ember-local`), so every
 * write is all or nothing. Every read goes to IndexedDB and every change is a read-modify-write inside one readwrite
 * transaction, so several tabs never overwrite each other's changes.
 */
export class LocalStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async transact<T>(
    mode: IDBTransactionMode,
    run: (objects: IDBObjectStore, current: LocalData | null) => T,
  ): Promise<T> {
    const transaction = (await this.open()).transaction(storeName, mode);
    const objects = transaction.objectStore(storeName);
    return new Promise<T>((resolve, reject) => {
      let result: T;
      let failure: unknown = null;
      const get = objects.get(key);
      get.onsuccess = () => {
        try {
          result = run(objects, (get.result as LocalData | undefined) ?? null);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () =>
        reject(failure ?? transaction.error ?? new Error('Transaction aborted'));
    });
  }

  /** The device data, or null when there is none. */
  load(): Promise<LocalData | null> {
    return this.transact('readonly', (_objects, current) => current);
  }

  /** True when device data exists. */
  async exists(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  /**
   * Writes `fn(current)` in the same transaction that read `current` (`fn` is synchronous and may change its argument).
   * Rejects, writing nothing, when there is no device data or `fn` throws. Resolves what was written.
   */
  update(fn: (data: LocalData) => LocalData): Promise<LocalData> {
    return this.upsert((current) => {
      if (!current) throw new Error('No device data.');
      return fn(current);
    });
  }

  /** Like {@link update}, but `fn` also runs (with null) when there is no device data yet. */
  upsert(fn: (data: LocalData | null) => LocalData): Promise<LocalData> {
    return this.transact('readwrite', (objects, current) => {
      const next = fn(current);
      objects.put(next, key);
      return next;
    });
  }

  /** Replaces all device data in one write. */
  replace(data: LocalData): Promise<void> {
    return this.upsert(() => data).then(() => undefined);
  }

  /** Deletes the device data. */
  clear(): Promise<void> {
    return this.transact('readwrite', (objects) => void objects.delete(key));
  }
}
