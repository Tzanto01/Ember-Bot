import type { ExportFile } from '../api-client';
import type { DayNote, LocalDateString, OwnMood } from '../models';
import type { Store } from '../store';

/** `off`: plain journal. `locked`: private journal without its key on this device. `unlocked`: key at hand. */
export type JournalState = 'off' | 'locked' | 'unlocked';

/** A secret that unlocks the private journal on this device. */
export type JournalSecret = { passphrase: string } | { recoveryCode: string };

/** Thrown by reads and writes that need the key while the private journal is locked. */
export class JournalLockedError extends Error {
  constructor() {
    super('The private journal is locked on this device.');
    this.name = 'JournalLockedError';
  }
}

/** Thrown when a passphrase or recovery code doesn't unwrap the journal key. */
export class WrongSecretError extends Error {
  constructor() {
    super("That passphrase or recovery code doesn't open the journal.");
    this.name = 'WrongSecretError';
  }
}

/**
 * The day journal for the signed-in user, plain or end-to-end encrypted (contract "Journal for the day" and
 * "Private journal"). Screens use only this; it hides whether entries are encrypted.
 */
export interface JournalApi {
  /** Follows `me.journal` and whether this device holds the key. */
  readonly state: Store<JournalState>;
  /** Bumps after any journal or mood write, so screens can reload. */
  readonly changed: Store<number>;
  /**
   * True while a switch back to a plain journal is under way (`me.journal.turningOff`). Writes go as plaintext then;
   * once unlocked, the re-upload resumes on its own, and `disable(password)` finishes it.
   */
  readonly turningOff: Store<boolean>;
  /** True when this device keeps the unlocked key (remember on this device); false for memory only or locked. */
  readonly remembered: Store<boolean>;

  /** Readable entries in the range, oldest first. `hidden` counts encrypted entries this device can't read (locked). */
  notes(from?: LocalDateString, to?: LocalDateString): Promise<{ notes: DayNote[]; hidden: number }>;
  /** Saves (encrypting when private) or, with both null, deletes the day's entry. Offline it is queued. */
  save(date: LocalDateString, entry: { text: string | null; mood: DayNote['mood'] }): Promise<{ queued: boolean }>;

  /** Own moods, archived included; empty while locked. */
  moods(): Promise<OwnMood[]>;
  addMood(mood: { label: string; emoji: string | null }): Promise<OwnMood>;
  updateMood(id: number, patch: { label?: string; emoji?: string | null; archived?: boolean }): Promise<OwnMood>;

  /** Re-reads the key state for the signed-in user (remembered key on this device). Call after `me` loads. */
  restore(): Promise<void>;
  /** Turns the private journal on: new key, encrypts existing entries and moods. Resolves the one-time recovery code. */
  enable(passphrase: string, remember: boolean, password?: string): Promise<{ recoveryCode: string }>;
  /** Unlocks this device. After a recovery code `needsNewPassphrase` is true and `setPassphrase` must follow. */
  unlock(secret: JournalSecret, remember: boolean): Promise<{ needsNewPassphrase: boolean }>;
  /**
   * Re-wraps the key with a new passphrase (`PUT` with `ifVersion`). Needs a passphrase or recovery-code `unlock`
   * shortly before (a key remembered on this device can't be re-wrapped); `JournalLockedError` otherwise.
   */
  setPassphrase(passphrase: string, password?: string): Promise<void>;
  /** Encrypts plaintext entries and moods left over while `me.journal.plaintextLeft > 0`. */
  finishMigration(): Promise<void>;
  /**
   * Back to a plain journal: `turn-off` (unless already turning off), decrypts and re-uploads everything, then deletes
   * the key. Also finishes an interrupted switch-off. Needs the key unlocked.
   */
  disable(password?: string): Promise<void>;
  /** "Lost both": deletes every encrypted entry and mood with the key. */
  discard(password?: string): Promise<void>;
  /** The readable journal as a file, built on the client. */
  exportDecrypted(): Promise<ExportFile>;
  /** Forgets the key on this device (sign-out, session end, account delete). Never throws. */
  forget(): Promise<void>;
}
