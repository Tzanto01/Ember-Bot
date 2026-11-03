import type { SecureStore } from '../native/token-store';
import { fromBase64, importJournalKey, toBase64 } from './crypto';

const dbName = 'ember-journal';
const storeName = 'keys';
const secureKey = 'ember.journalKey';

/** A journal key and the id of the server key it belongs to (`recovery.salt`), to notice a replaced key. */
export interface KeyEntry {
  key: CryptoKey;
  keyId: string;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Where this device keeps the journal key, per user id (contract "Unlocking"). In memory always; when remembered,
 * on the web as a non-extractable `CryptoKey` in its own IndexedDB, in the native build (`secure` set) as raw key
 * bytes in secure storage, imported non-extractable for use. A key stored for another user is never returned.
 */
export class Keyring {
  private memory: (KeyEntry & { userId: string; remembered: boolean }) | null = null;
  private db: Promise<IDBDatabase> | null = null;

  /** `secure`: the native build's secure storage; null on the web. */
  constructor(private readonly secure: SecureStore | null) {}

  /**
   * The key for `userId`: from memory, else from this device's storage, else null; `remembered` when this device
   * keeps it. Never throws.
   */
  async get(userId: string): Promise<(KeyEntry & { remembered: boolean }) | null> {
    if (this.memory?.userId === userId) {
      const { key, keyId, remembered } = this.memory;
      return { key, keyId, remembered };
    }
    try {
      const entry = this.secure ? await this.readSecure(userId) : await this.readDb(userId);
      if (!entry) return null;
      this.memory = { userId, ...entry, remembered: true };
      return { ...entry, remembered: true };
    } catch {
      return null;
    }
  }

  /**
   * Holds `key` for `userId`; with `remember`, also on this device (native: `raw` in secure storage), otherwise
   * removes what this device remembered. The caller wipes `raw` afterwards.
   */
  async keep(userId: string, entry: KeyEntry, raw: Uint8Array, remember: boolean): Promise<void> {
    const memory = { userId, key: entry.key, keyId: entry.keyId, remembered: false };
    this.memory = memory;
    if (this.secure) {
      if (remember) {
        await this.secure.set(
          secureKey,
          JSON.stringify({ userId, keyId: entry.keyId, key: toBase64(raw) }),
        );
      } else {
        await this.secure.remove(secureKey);
      }
      memory.remembered = remember;
      return;
    }
    const db = await this.open();
    const tx = db.transaction(storeName, 'readwrite');
    if (remember) tx.objectStore(storeName).put({ key: entry.key, keyId: entry.keyId }, userId);
    else tx.objectStore(storeName).delete(userId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    memory.remembered = remember;
  }

  /** Forgets every journal key: memory, IndexedDB and secure storage. Never throws. */
  async forget(): Promise<void> {
    this.memory = null;
    if (this.secure) {
      await this.secure
        .remove(secureKey)
        .catch(() => this.secure?.remove(secureKey))
        .catch(() => undefined);
    }
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await this.open();
      await done(db.transaction(storeName, 'readwrite').objectStore(storeName).clear());
    } catch {
      return;
    }
  }

  private async readSecure(userId: string): Promise<KeyEntry | null> {
    const stored = await this.secure!.get(secureKey);
    if (!stored) return null;
    const value = JSON.parse(stored) as { userId?: unknown; keyId?: unknown; key?: unknown };
    if (value.userId !== userId || typeof value.keyId !== 'string' || typeof value.key !== 'string')
      return null;
    const raw = fromBase64(value.key);
    try {
      return raw.length === 32 ? { key: await importJournalKey(raw), keyId: value.keyId } : null;
    } finally {
      raw.fill(0);
    }
  }

  private async readDb(userId: string): Promise<KeyEntry | null> {
    const db = await this.open();
    const value = (await done(db.transaction(storeName).objectStore(storeName).get(userId))) as
      Partial<KeyEntry> | undefined;
    return value?.key instanceof CryptoKey && typeof value.keyId === 'string'
      ? { key: value.key, keyId: value.keyId }
      : null;
  }

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
}
