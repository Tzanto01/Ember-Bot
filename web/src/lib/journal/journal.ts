import type { ApiClient, ExportFile } from '../api-client';
import type { NoteEdit } from '../device-store';
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
import type { DroppedNote, ResealResult } from '../offline-queue';
import { ApiError, asApiError } from '../problem';
import { Store } from '../store';
import type { HelpsList } from '../helps/types';
import {
  decryptHelps,
  decryptMood,
  decryptNote,
  encryptHelps,
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
import { t } from '../i18n';
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
  | 'turnOffJournal'
  | 'listHabits'
  | 'getHelps'
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
  if (trimmed.length > maxText) throw new RangeError(t('journal.error.tooLong'));
  return trimmed;
}

function moodLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > maxLabel)
    throw new RangeError(t('journal.error.moodName'));
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
  readonly turningOff = new Store(false);
  readonly remembered = new Store(false);

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
  private reuploading: Promise<void> | null = null;
  private replayingHeld: Promise<void> | null = null;

  /** Set by the composition root: a held journal edit the server refused on replay, for the gentle notice. */
  onDroppedNote: ((note: DroppedNote) => void) | null = null;
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
    const key = this.sealingKey(me);
    if (key && body) body = { encrypted: await encryptNote(key, date, { text, mood }) };
    const { queued } = await this.api.saveDayNote(date, body);
    if (!queued) this.bump();
    return { queued };
  }

  async appendPrivate(date: LocalDateString, block: string): Promise<void> {
    const me = this.requireMe();
    if (!me.journal.encrypted || me.journal.turningOff) throw new Error('The private journal is off.');
    const key = this.requireKey();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Offline.');
    const addition = block.trim();
    if (!addition) throw new RangeError('Nothing to add.');
    await this.replayingHeld?.catch(() => undefined);
    const [stored] = (await this.api.listDayNotes(date, date)).filter((n) => n.date === date);
    let current: { text: string | null; mood: MoodKey | null } = { text: null, mood: null };
    if (stored) {
      current = isEncrypted(stored)
        ? await decryptNote(key, date, stored.encrypted)
        : { text: stored.text, mood: stored.mood };
    }
    const before = current.text?.trim() ?? '';
    if (before.endsWith(addition)) return;
    const text = before ? `${before}\n\n${addition}` : addition;
    if (text.length > maxText) throw new RangeError(t('journal.error.tooLong'));
    const encrypted = await encryptNote(key, date, { text, mood: current.mood ?? null });
    if (this.key !== key || this.session.me.get()?.id !== me.id) throw new JournalLockedError();
    await this.api.sendNoteEdit({ kind: 'note', date, body: { encrypted } });
    this.bump();
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
    const key = this.sealingKey(me);
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
    const key = this.sealingKey(me);
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

  /**
   * The "What helps me" list sealed as the API's `encrypted` string (the day-note envelope as JSON text). Throws
   * `JournalLockedError` unless the private journal is on, not turning off, and unlocked.
   */
  async sealHelps(list: HelpsList): Promise<string> {
    return JSON.stringify(await encryptHelps(this.helpsKey(), list));
  }

  /** The "What helps me" list from the API's `encrypted` string. Same conditions as {@link sealHelps}. */
  openHelps(encrypted: string): Promise<HelpsList> {
    const key = this.helpsKey();
    return decryptHelps(key, JSON.parse(encrypted) as EncryptedBlob);
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
    if (!passphrase.trim()) throw new RangeError(t('journal.error.passphrase'));
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
      await this.keyring.keep(me.id, { key, keyId: body.recovery.salt }, raw, remember).then(
        () => this.remembered.set(remember),
        () => this.remembered.set(false),
      );
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
      await this.keyring.keep(me.id, { key, keyId: stored.recovery.salt }, raw, remember).then(
        () => this.remembered.set(remember),
        () => this.remembered.set(false),
      );
      this.key = key;
      this.keyUser = me.id;
      this.holdRewrap({ userId: me.id, raw, version: stored.version, recovery: stored.recovery });
    } catch (error) {
      raw.fill(0);
      throw error;
    }
    this.refresh();
    this.bump();
    this.resume(me);
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
    if (!passphrase.trim()) throw new RangeError(t('journal.error.passphrase'));
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

  /**
   * Starts the switch-off (`POST .../turn-off`) unless one is under way, re-uploads everything as plaintext, then
   * deletes the key. Also finishes an interrupted switch-off (`turningOff`); needs the key unlocked.
   */
  async disable(password?: string): Promise<void> {
    const me = this.requireMe();
    this.requireKey();
    const pw = me.hasPassword ? password : undefined;
    if (!me.journal.turningOff) {
      await this.api.turnOffJournal({ password: pw });
      await this.session.loadMe(true).catch(() => null);
    }
    const body = { password: pw, discardEncrypted: false };
    await this.finishTurnOff();
    try {
      await this.api.deleteJournalKey(body);
    } catch (error) {
      if (asApiError(error).status !== 409) throw error;
      await this.finishTurnOff();
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
    const sealedHelps = me.journal.encrypted && !me.journal.turningOff ? await this.api.getHelps() : null;
    const helps = sealedHelps ? (await this.openHelps(sealedHelps.encrypted)).items : [];
    const file = { exportedAt: new Date().toISOString(), entries, moods, helps };
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
    if (!this.key) this.remembered.set(false);
    this.turningOff.set(!!me?.journal.encrypted && me.journal.turningOff);
    this.state.set(!me?.journal.encrypted ? 'off' : this.key ? 'unlocked' : 'locked');
  }

  /** The key to encrypt writes with: null for a plain journal or while turning off; locked throws. */
  private sealingKey(me: Me): CryptoKey | null {
    return me.journal.encrypted && !me.journal.turningOff ? this.requireKey() : null;
  }

  /**
   * Converts a queued journal edit refused with 400 to the journal's current form (contract "Offline day edits"):
   * encrypted while private, plaintext while turning off or off. Locked with a form it can't produce, it holds the
   * edit on this device for the next unlock. An edit already in the current form (another 400) is dropped.
   */
  async resealNote(edit: NoteEdit): Promise<ResealResult> {
    const me = (await this.session.loadMe(true).catch(() => null)) ?? this.session.me.get();
    const body = edit.body;
    if (!me || !body) return { dropText: null };
    const key = this.key && this.keyUser === me.id ? this.key : null;
    const sealed = me.journal.encrypted && !me.journal.turningOff;
    let plain: { text: string | null; mood: MoodKey | null };
    if (isEncrypted(body)) {
      if (!key) return me.journal.turningOff ? this.holdNote(me.id, edit) : { dropText: null };
      try {
        plain = await decryptNote(key, edit.date, body.encrypted);
      } catch {
        return { dropText: null };
      }
      if (sealed) return { dropText: plain.text };
      return { edit: { ...edit, body: plain } };
    }
    plain = { text: body.text ?? null, mood: body.mood ?? null };
    if (!sealed) return { dropText: plain.text };
    if (!key) return this.holdNote(me.id, edit);
    return { edit: { ...edit, body: { encrypted: await encryptNote(key, edit.date, plain) } } };
  }

  private async holdNote(userId: string, edit: NoteEdit): Promise<'hold'> {
    await this.keyring.hold(userId, edit);
    return 'hold';
  }

  private replayHeld(): Promise<void> {
    this.replayingHeld ??= this.runHeld().finally(() => (this.replayingHeld = null));
    return this.replayingHeld;
  }

  /** Saves held journal edits in the journal's current form; a refused one is dropped and reported. */
  private async runHeld(): Promise<void> {
    const me = this.session.me.get();
    const key = this.key;
    if (!me || !key || this.keyUser !== me.id) return;
    for (const { id, edit } of await this.keyring.held(me.id)) {
      if (this.key !== key) return;
      let text: string | null = null;
      try {
        const body = edit.body;
        if (body) {
          const plain = isEncrypted(body)
            ? await decryptNote(key, edit.date, body.encrypted)
            : { text: body.text ?? null, mood: body.mood ?? null };
          text = plain.text;
          await this.save(edit.date, plain);
        }
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 400;
        if (status !== 400 && status !== 404 && status !== 422) continue;
        this.onDroppedNote?.({ date: edit.date, text });
      }
      await this.keyring.release(id).catch(() => undefined);
    }
  }

  /** Continues interrupted work in the background once the key is at hand. */
  private resume(me: Me): void {
    if (this.state.get() !== 'unlocked') return;
    void this.replayHeld().catch(() => undefined);
    if (!me.journal.turningOff && me.journal.plaintextLeft > 0)
      void this.finishMigration().catch(() => undefined);
  }

  private finishTurnOff(): Promise<void> {
    this.reuploading ??= this.reupload().finally(() => (this.reuploading = null));
    return this.reuploading;
  }

  /** Decrypts every encrypted mood and entry and writes it back as plaintext (switch-off under way). */
  private async reupload(): Promise<void> {
    const key = this.requireKey();
    const userId = this.keyUser;
    for (const mood of await this.api.listMoods()) {
      if (isEncrypted(mood)) {
        await this.api.updateMood(mood.id, await decryptMood(key, mood.encrypted));
      }
    }
    await this.scan(async (notes) => {
      for (const note of notes) {
        if (!isEncrypted(note) || this.key !== key) continue;
        const body = await decryptNote(key, note.date, note.encrypted);
        await this.api.sendNoteEdit({ kind: 'note', date: note.date, body });
      }
      const me = await this.session.loadMe(true);
      return (
        this.key !== key ||
        me?.id !== userId ||
        !me.journal.turningOff ||
        me.journal.encryptedLeft <= 0
      );
    });
    this.bump();
  }

  private async runRestore(): Promise<void> {
    const me = this.session.me.get();
    if (!me?.journal.encrypted || (this.key && this.keyUser === me.id)) {
      this.refresh();
      if (me) this.resume(me);
      return;
    }
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
      this.remembered.set(entry.remembered);
    }
    this.refresh();
    this.resume(me);
  }

  private async migrate(): Promise<void> {
    let me = await this.session.loadMe(true);
    const key = this.key;
    if (
      !me?.journal.encrypted ||
      me.journal.turningOff ||
      !key ||
      me.id !== this.keyUser ||
      me.journal.plaintextLeft <= 0
    )
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
        me.journal.turningOff ||
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

  private helpsKey(): CryptoKey {
    const me = this.session.me.get();
    if (!me?.journal.encrypted || me.journal.turningOff) throw new JournalLockedError();
    return this.requireKey();
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
