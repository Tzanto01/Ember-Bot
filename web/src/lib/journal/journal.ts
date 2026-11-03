import type { ApiClient, ExportFile } from '../api-client';
import { addDays } from '../local-date';
import type {
  DayNote,
  DayNoteBody,
  EncryptedBlob,
  JournalKey,
  LocalDateString,
  Me,
  MoodKey,
  MoodPatchBody,
  OwnMood,
  StoredDayNote,
  StoredMood,
} from '../models';
import { ApiError, asApiError } from '../problem';
import { Store } from '../store';
import {
  decryptMood,
  decryptNote,
  encryptMood,
  encryptNote,
  importJournalKey,
  newJournalKeyBytes,
  newRecoveryCode,
  passphraseIterations,
  recoveryCodeBytes,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  wrapWithPassphrase,
  wrapWithRecovery,
} from './crypto';
import type { Keyring } from './keyring';
import {
  type JournalApi,
  JournalLockedError,
  type JournalSecret,
  type JournalState,
  WrongSecretError,
} from './types';

/** The API calls the journal uses; a local data source (no-account mode) can provide the same. */
export type JournalSource = Pick<
  ApiClient,
  | 'listDayNotes'
  | 'saveDayNote'
  | 'sendNoteEdit'
  | 'listMoods'
  | 'createMood'
  | 'updateMood'
  | 'getJournalKey'
  | 'putJournalKey'
  | 'deleteJournalKey'
  | 'listHabits'
>;

/** The signed-in user, as `AuthService` provides it. */
export interface JournalSession {
  readonly me: Store<Me | null>;
  loadMe(force?: boolean): Promise<Me | null>;
}

export interface JournalOptions {
  /** PBKDF2 iterations for new wraps and the least accepted on unlock. Tests only; the default is the contract's. */
  iterations?: number;
}

/** How long the unwrapped key bytes stay available for `setPassphrase` after an unlock. */
const rewrapMs = 10 * 60 * 1000;
/** Scans for entries go back at least this far, further when a habit started earlier. */
const minScanDays = 3660;
const maxText = 2000;
const maxLabel = 24;

type Bytes = Uint8Array<ArrayBuffer>;

function entryText(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length > maxText) throw new RangeError('Keep the entry to 2000 characters or fewer.');
  return trimmed;
}

function moodLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > maxLabel)
    throw new RangeError('Give the mood a name of up to 24 characters.');
  return trimmed;
}

const isEncrypted = <T extends object>(value: T): value is Extract<T, { encrypted: unknown }> =>
  'encrypted' in value && !!value.encrypted;

/**
 * The day journal (contract "Journal for the day" and "Private journal"): plain, or end-to-end encrypted with a
 * journal key that only this client sees unwrapped. The passphrase, recovery code and raw key never leave the
 * service except in their wrapped forms.
 */
export class JournalService implements JournalApi {
  readonly state = new Store<JournalState>('off');
  readonly changed = new Store(0);

  private key: CryptoKey | null = null;
  private keyUser: string | null = null;
  private epoch = 0;
  private rewrap: {
    userId: string;
    raw: Bytes;
    version: number;
    recovery: JournalKey['recovery'];
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private migrating: Promise<void> | null = null;
  private restoring: Promise<void> | null = null;
  private readonly iterations: number;

  constructor(
    private readonly api: JournalSource,
    private readonly session: JournalSession,
    private readonly keyring: Keyring,
    options: JournalOptions = {},
  ) {
    this.iterations = options.iterations ?? passphraseIterations;
    session.me.subscribe(() => this.refresh());
    this.refresh();
  }

  async notes(
    from?: LocalDateString,
    to?: LocalDateString,
  ): Promise<{ notes: DayNote[]; hidden: number }> {
    return this.readNotes(await this.api.listDayNotes(from, to));
  }

  async save(
    date: LocalDateString,
    entry: { text: string | null; mood: DayNote['mood'] },
  ): Promise<{ queued: boolean }> {
    const me = this.requireMe();
    const text = entryText(entry.text);
    const mood = entry.mood ?? null;
    let body: DayNoteBody | null = text === null && mood === null ? null : { text, mood };
    if (me.journal.encrypted) {
      const key = this.requireKey();
      if (body) body = { encrypted: await encryptNote(key, date, { text, mood }) };
    }
    const { queued } = await this.api.saveDayNote(date, body);
    this.bump();
    return { queued };
  }

  async moods(): Promise<OwnMood[]> {
    if (this.session.me.get()?.journal.encrypted && !this.key) return [];
    const key = this.key;
    const moods: OwnMood[] = [];
    for (const stored of await this.api.listMoods()) {
      try {
        moods.push(await this.readMood(stored, key));
      } catch {
        continue;
      }
    }
    return moods;
  }

  async addMood(mood: { label: string; emoji: string | null }): Promise<OwnMood> {
    const me = this.requireMe();
    const plain = { label: moodLabel(mood.label), emoji: mood.emoji };
    const key = me.journal.encrypted ? this.requireKey() : null;
    const stored = await this.api.createMood(
      key ? { encrypted: await encryptMood(key, plain) } : plain,
    );
    this.bump();
    return this.readMood(stored, key);
  }

  async updateMood(
    id: number,
    patch: { label?: string; emoji?: string | null; archived?: boolean },
  ): Promise<OwnMood> {
    const me = this.requireMe();
    const label = patch.label === undefined ? undefined : moodLabel(patch.label);
    const key = me.journal.encrypted ? this.requireKey() : null;
    let body: MoodPatchBody = { label, emoji: patch.emoji, archived: patch.archived };
    if (key) {
      let encrypted: EncryptedBlob | undefined;
      if (label !== undefined || patch.emoji !== undefined) {
        const current = (await this.moods()).find((m) => m.id === id);
        if (!current) throw new ApiError(404, null);
        encrypted = await encryptMood(key, {
          label: label ?? current.label,
          emoji: patch.emoji === undefined ? current.emoji : patch.emoji,
        });
      }
      body = { encrypted, archived: patch.archived };
    }
    const stored = await this.api.updateMood(id, body);
    this.bump();
    return this.readMood(stored, key);
  }

  restore(): Promise<void> {
    this.restoring ??= this.runRestore().finally(() => (this.restoring = null));
    return this.restoring;
  }

  async enable(
    passphrase: string,
    remember: boolean,
    password?: string,
  ): Promise<{ recoveryCode: string }> {
    const me = this.requireMe();
    if (!passphrase.trim()) throw new RangeError('Choose a passphrase.');
    const raw = newJournalKeyBytes();
    try {
      const recovery = await newRecoveryCode();
      const body = {
        passphrase: await wrapWithPassphrase(raw, passphrase, this.iterations),
        recovery: await wrapWithRecovery(raw, recovery.bytes),
        password: me.hasPassword ? password : undefined,
      };
      recovery.bytes.fill(0);
      await this.api.putJournalKey(body);
      const key = await importJournalKey(raw);
      this.epoch++;
      this.key = key;
      this.keyUser = me.id;
      await this.keyring
        .keep(me.id, { key, keyId: body.recovery.salt }, raw, remember)
        .catch(() => undefined);
      await this.session.loadMe(true).catch(() => null);
      this.refresh();
      this.bump();
      await this.finishMigration().catch(() => undefined);
      return { recoveryCode: recovery.code };
    } finally {
      raw.fill(0);
    }
  }

  async unlock(secret: JournalSecret, remember: boolean): Promise<{ needsNewPassphrase: boolean }> {
    const me = this.requireMe();
    const epoch = this.epoch;
    const stored = await this.api.getJournalKey();
    let raw: Bytes;
    if ('passphrase' in secret) {
      raw = await unwrapWithPassphrase(stored.passphrase, secret.passphrase, this.iterations);
    } else {
      const code = await recoveryCodeBytes(secret.recoveryCode);
      try {
        raw = await unwrapWithRecovery(stored.recovery, code);
      } finally {
        code.fill(0);
      }
    }
    try {
      if (raw.length !== 32) throw new WrongSecretError();
      const key = await importJournalKey(raw);
      if (epoch !== this.epoch || this.session.me.get()?.id !== me.id)
        throw new JournalLockedError();
      await this.keyring
        .keep(me.id, { key, keyId: stored.recovery.salt }, raw, remember)
        .catch(() => undefined);
      this.key = key;
      this.keyUser = me.id;
      this.holdRewrap({ userId: me.id, raw, version: stored.version, recovery: stored.recovery });
    } catch (error) {
      raw.fill(0);
      throw error;
    }
    this.refresh();
    this.bump();
    void this.finishMigration().catch(() => undefined);
    return { needsNewPassphrase: !('passphrase' in secret) };
  }

  /**
   * Re-wraps the key with a new passphrase, keeping the recovery part, with `ifVersion` from the unlock. Needs an
   * unlock with a passphrase or recovery code in the last 10 minutes (a remembered key can't be re-wrapped);
   * `JournalLockedError` otherwise. On 409 (the key changed elsewhere) reloads `me` and rejects with the `ApiError`.
   */
  async setPassphrase(passphrase: string, password?: string): Promise<void> {
    const me = this.requireMe();
    const hold = this.rewrap;
    if (!this.key || !hold || hold.userId !== me.id) throw new JournalLockedError();
    if (!passphrase.trim()) throw new RangeError('Choose a passphrase.');
    const body = {
      passphrase: await wrapWithPassphrase(hold.raw, passphrase, this.iterations),
      recovery: hold.recovery,
      password: me.hasPassword ? password : undefined,
      ifVersion: hold.version,
    };
    try {
      await this.api.putJournalKey(body);
    } catch (error) {
      if (asApiError(error).status === 409) await this.session.loadMe(true).catch(() => null);
      throw error;
    }
    this.dropRewrap();
  }

  finishMigration(): Promise<void> {
    this.migrating ??= this.migrate().finally(() => (this.migrating = null));
    return this.migrating;
  }

  async disable(password?: string): Promise<void> {
    const me = this.requireMe();
    const key = this.requireKey();
    const decryptAll = async () => {
      for (const mood of await this.api.listMoods()) {
        if (isEncrypted(mood))
          await this.api.updateMood(mood.id, await decryptMood(key, mood.encrypted));
      }
      await this.scan(async (notes) => {
        for (const note of notes) {
          if (!isEncrypted(note)) continue;
          const body = await decryptNote(key, note.date, note.encrypted);
          await this.api.sendNoteEdit({ kind: 'note', date: note.date, body });
        }
        return false;
      });
    };
    const body = { password: me.hasPassword ? password : undefined, discardEncrypted: false };
    await decryptAll();
    try {
      await this.api.deleteJournalKey(body);
    } catch (error) {
      if (asApiError(error).status !== 409) throw error;
      await decryptAll();
      await this.api.deleteJournalKey(body);
    }
    await this.forget();
    await this.session.loadMe(true).catch(() => null);
    this.bump();
  }

  async discard(password?: string): Promise<void> {
    const me = this.requireMe();
    await this.api.deleteJournalKey({
      password: me.hasPassword ? password : undefined,
      discardEncrypted: true,
    });
    await this.forget();
    await this.session.loadMe(true).catch(() => null);
    this.bump();
  }

  async exportDecrypted(): Promise<ExportFile> {
    const me = this.requireMe();
    if (me.journal.encrypted) this.requireKey();
    const moods = await this.moods();
    const labels = new Map<string, string>(moods.map((m) => [`custom:${m.id}`, m.label]));
    const label = (mood: MoodKey | null) =>
      mood === null
        ? null
        : mood.startsWith('custom:')
          ? (labels.get(mood) ?? null)
          : mood.charAt(0).toUpperCase() + mood.slice(1);
    const entries: {
      date: LocalDateString;
      text: string | null;
      mood: MoodKey | null;
      moodLabel: string | null;
    }[] = [];
    await this.scan(async (stored) => {
      const { notes } = await this.readNotes(stored);
      entries.unshift(
        ...notes.map((n) => ({
          date: n.date,
          text: n.text,
          mood: n.mood,
          moodLabel: label(n.mood),
        })),
      );
      return false;
    });
    const file = { exportedAt: new Date().toISOString(), entries, moods };
    return {
      blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      fileName: `ember-journal-${me.localToday}.json`,
    };
  }

  async forget(): Promise<void> {
    this.epoch++;
    this.key = null;
    this.keyUser = null;
    this.dropRewrap();
    this.refresh();
    await this.keyring.forget();
  }

  private refresh(): void {
    const me = this.session.me.get();
    if (!me || me.id !== this.keyUser) {
      this.key = null;
      this.keyUser = null;
    }
    if (this.rewrap && this.rewrap.userId !== me?.id) this.dropRewrap();
    this.state.set(!me?.journal.encrypted ? 'off' : this.key ? 'unlocked' : 'locked');
  }

  private async runRestore(): Promise<void> {
    const me = this.session.me.get();
    if (!me?.journal.encrypted || (this.key && this.keyUser === me.id)) return this.refresh();
    const epoch = this.epoch;
    let entry = await this.keyring.get(me.id);
    if (entry) {
      try {
        if ((await this.api.getJournalKey()).recovery.salt !== entry.keyId) entry = null;
      } catch (error) {
        if (asApiError(error).status === 404) entry = null;
      }
      if (!entry && epoch === this.epoch) await this.keyring.forget();
    }
    if (entry && epoch === this.epoch && this.session.me.get()?.id === me.id) {
      this.key = entry.key;
      this.keyUser = me.id;
    }
    this.refresh();
    if (this.state.get() === 'unlocked' && me.journal.plaintextLeft > 0) {
      void this.finishMigration().catch(() => undefined);
    }
  }

  private async migrate(): Promise<void> {
    let me = await this.session.loadMe(true);
    const key = this.key;
    if (!me?.journal.encrypted || !key || me.id !== this.keyUser || me.journal.plaintextLeft <= 0)
      return;
    const userId = me.id;
    for (const mood of await this.api.listMoods()) {
      if (!isEncrypted(mood)) {
        await this.api.updateMood(mood.id, { encrypted: await encryptMood(key, mood) });
      }
    }
    await this.scan(async (notes) => {
      for (const note of notes) {
        if (isEncrypted(note) || this.key !== key) continue;
        const encrypted = await encryptNote(key, note.date, note);
        await this.api.sendNoteEdit({ kind: 'note', date: note.date, body: { encrypted } });
      }
      me = await this.session.loadMe(true);
      return (
        this.key !== key ||
        me?.id !== userId ||
        !me.journal.encrypted ||
        me.journal.plaintextLeft <= 0
      );
    });
    this.bump();
  }

  /** Walks `GET /api/day-notes` back from local today in 366-day windows until `visit` returns true or the floor. */
  private async scan(visit: (notes: StoredDayNote[]) => Promise<boolean>): Promise<void> {
    const today = this.requireMe().localToday;
    const habits = await this.api.listHabits().catch(() => []);
    let floor = addDays(today, -minScanDays);
    for (const habit of habits) if (habit.startDate < floor) floor = habit.startDate;
    for (let to = today; to >= floor;) {
      const from = addDays(to, -365);
      if (await visit(await this.api.listDayNotes(from, to))) return;
      to = addDays(from, -1);
    }
  }

  private async readNotes(stored: StoredDayNote[]): Promise<{ notes: DayNote[]; hidden: number }> {
    const key = this.key;
    const notes: DayNote[] = [];
    let hidden = 0;
    for (const note of stored) {
      if (!isEncrypted(note)) {
        notes.push({ date: note.date, text: note.text, mood: note.mood });
        continue;
      }
      try {
        if (!key) throw new JournalLockedError();
        notes.push({ date: note.date, ...(await decryptNote(key, note.date, note.encrypted)) });
      } catch {
        hidden++;
      }
    }
    return { notes, hidden };
  }

  private async readMood(stored: StoredMood, key: CryptoKey | null): Promise<OwnMood> {
    if (!isEncrypted(stored)) {
      return { id: stored.id, label: stored.label, emoji: stored.emoji, archived: stored.archived };
    }
    if (!key) throw new JournalLockedError();
    return {
      id: stored.id,
      archived: stored.archived,
      ...(await decryptMood(key, stored.encrypted)),
    };
  }

  private requireMe(): Me {
    const me = this.session.me.get();
    if (!me) throw new Error('Not signed in.');
    return me;
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new JournalLockedError();
    return this.key;
  }

  private holdRewrap(hold: {
    userId: string;
    raw: Bytes;
    version: number;
    recovery: JournalKey['recovery'];
  }): void {
    this.dropRewrap();
    this.rewrap = { ...hold, timer: setTimeout(() => this.dropRewrap(), rewrapMs) };
  }

  private dropRewrap(): void {
    if (!this.rewrap) return;
    clearTimeout(this.rewrap.timer);
    this.rewrap.raw.fill(0);
    this.rewrap = null;
  }

  private bump(): void {
    this.changed.update((n) => n + 1);
  }
}
