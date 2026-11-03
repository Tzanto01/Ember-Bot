import type { LocalData } from './types';

const dbName = 'ember-local';
const storeName = 'data';
const key = 'data';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
  });
}

/**
 * No-account mode's device data: the whole {@link LocalData} as one IndexedDB record (database `ember-local`), so every
 * write is all or nothing. Reads and writes run one after another in call order; the last written value is cached.
 */
export class LocalStore {
  private db: Promise<IDBDatabase> | null = null;
  private cache: LocalData | null | undefined;
  private queue: Promise<unknown> = Promise.resolve();

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

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<LocalData | null> {
    if (this.cache !== undefined) return this.cache;
    const db = await this.open();
    const value = (await done(db.transaction(storeName, 'readonly').objectStore(storeName).get(key))) as
      | LocalData
      | undefined;
    this.cache = value ?? null;
    return this.cache;
  }

  private async write(data: LocalData | null): Promise<void> {
    const transaction = (await this.open()).transaction(storeName, 'readwrite');
    const objects = transaction.objectStore(storeName);
    if (data) objects.put(data, key);
    else objects.delete(key);
    await committed(transaction);
    this.cache = data;
  }

  /** A copy of the device data, or null when there is none. */
  load(): Promise<LocalData | null> {
    return this.serial(async () => {
      const data = await this.read();
      return data && structuredClone(data);
    });
  }

  /** True when device data exists. */
  exists(): Promise<boolean> {
    return this.serial(async () => (await this.read()) !== null);
  }

  /**
   * Writes `fn(current)` after every earlier write; `fn` gets a copy it may change. Rejects (writing nothing) when there
   * is no device data or `fn` throws. Resolves a copy of what was written.
   */
  update(fn: (data: LocalData) => LocalData): Promise<LocalData> {
    return this.serial(async () => {
      const current = await this.read();
      if (!current) throw new Error('No device data.');
      const next = fn(structuredClone(current));
      await this.write(next);
      return structuredClone(next);
    });
  }

  /** Replaces all device data in one write. */
  replace(data: LocalData): Promise<void> {
    return this.serial(() => this.write(structuredClone(data)));
  }

  /** Deletes the device data. */
  clear(): Promise<void> {
    return this.serial(() => this.write(null));
  }
}
