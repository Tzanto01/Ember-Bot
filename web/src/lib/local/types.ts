import type { ExportFile } from '../api-client';
import type { Frequency, LocalDateString, MoodKey, ReminderChannel, TimeOfDay, Weekday } from '../models';
import type { Store } from '../store';
import type { ThemeId } from '../theme';

/** A habit as stored on the device (no-account mode). */
export interface LocalHabit {
  id: number;
  name: string;
  frequency: Frequency;
  /** 1–6 for weekly habits, else null. */
  weeklyTarget: number | null;
  /** Monday-first scheduled weekdays for `weekdays` habits, else null. */
  days: Weekday[] | null;
  /** 1–10 for daily and weekdays habits, always 1 for weekly. */
  timesPerDay: number;
  reminderTime: TimeOfDay | null;
  reminderChannels: ReminderChannel[];
  pausedFrom: LocalDateString | null;
  pausedUntil: LocalDateString | null;
  /** ISO 8601 UTC instant; the local start day is its date in the profile's time zone (as in Core). */
  createdAt: string;
  routineId: number | null;
  routinePosition: number | null;
}

/** One habit day with a check-in; `completed` is fixed when written (a done day stays done). */
export interface LocalLog {
  habitId: number;
  date: LocalDateString;
  completed: boolean;
  count: number;
}

export interface LocalRoutine {
  id: number;
  name: string;
  reminderTime: TimeOfDay | null;
  reminderChannels: ReminderChannel[];
}

export interface LocalMood {
  id: number;
  label: string;
  emoji: string | null;
  archived: boolean;
}

export interface LocalNote {
  date: LocalDateString;
  text: string | null;
  mood: MoodKey | null;
}

/** The device profile: settings and bookkeeping of no-account mode. */
export interface LocalProfile {
  /** A random UUID made on this device; the local `Me.id` (reminders, widget and caches are keyed by it). */
  userId: string;
  timezone: string;
  graceDaysPerWeek: number;
  theme: ThemeId | null;
  /** ISO instant the local profile was made. */
  createdAt: string;
  /** ISO instant of the last successful backup export, or null. */
  lastBackupAt: string | null;
  /** ISO instant until which the backup reminder stays quiet, or null. */
  backupReminderSnoozedUntil: string | null;
  /** Next id per kind; ids are never reused on this device. */
  nextIds: { habit: number; routine: number; mood: number };
}

/** Everything no-account mode keeps, stored as one IndexedDB record so every write is all or nothing. */
export interface LocalData {
  profile: LocalProfile;
  habits: LocalHabit[];
  logs: LocalLog[];
  lowDays: LocalDateString[];
  routines: LocalRoutine[];
  moods: LocalMood[];
  notes: LocalNote[];
  /** Progress of a move into an account, so an interrupted upgrade resumes without importing twice. */
  upgrade?: UpgradeProgress;
}

/** What an upgrade already did for the account `userId`. */
export interface UpgradeProgress {
  userId: string;
  /** The import request was sent at least once (its answer may have been lost). */
  importSent: boolean;
  /** The account holds the habits, check-ins and low days (and, for a plain journal, the journal). */
  imported: boolean;
  /** Private journal: the journal key exists in the account. */
  journalEnabled: boolean;
  /** Private journal: the one-time recovery code, kept on the device only until the upgrade finishes. */
  recoveryCode: string | null;
  /** Private journal: device mood id to account mood id. */
  moodIds: Record<string, number>;
  /** Private journal: device ids of archived moods already archived in the account. */
  archivedMoods: number[];
  /** Private journal: dates of entries already saved in the account. */
  notesDone: string[];
}

/** Which data source the app runs on: the server (`account`), the device (`local`), or the server while device data waits for import (`upgrading`). */
export type AppMode = 'account' | 'local' | 'upgrading';

/** Switches between no-account mode and the account; the composition root wires it to `Http`, `AuthService` and the local backend. */
export interface LocalModeApi {
  readonly mode: Store<AppMode>;
  /** True after start-up found the local-mode flag but no device data (the browser likely cleared site data). */
  readonly evicted: Store<boolean>;
  /** Enters no-account mode: makes the profile if none exists, asks the browser to keep storage (web), loads the local `me`. */
  start(): Promise<void>;
  /** Leaves for sign-up or sign-in while keeping the device data (mode `upgrading`); the app talks to the server again. */
  beginUpgrade(): Promise<void>;
  /** Back to no-account mode from `upgrading` (signs out of the account on this device first when signed in). */
  cancelUpgrade(): Promise<void>;
  /** Deletes the device data and returns to the welcome screen (mode `account`, signed out). */
  wipe(): Promise<void>;
}

/** What a backup file holds, for the confirmation before it replaces the device data. */
export interface BackupSummary {
  habits: number;
  checkIns: number;
  lowDays: number;
  routines: number;
  notes: number;
  moods: number;
  /** Encrypted journal entries and moods in the file that can't be read without the account's passphrase; left out. */
  skippedEncrypted: number;
}

/** A parsed, validated backup file waiting for confirmation. */
export interface ParsedBackup {
  summary: BackupSummary;
  data: Omit<LocalData, 'profile'> & { settings: Pick<LocalProfile, 'timezone' | 'graceDaysPerWeek' | 'theme'> };
}

export interface BackupApi {
  /** The device data in the JSON export format v2 (`format_version: 2`); records the backup time. */
  exportBackup(): Promise<ExportFile>;
  /** Parses and validates an untrusted file's text; never throws. `error` is short user-facing copy. */
  parseBackup(text: string): ParsedBackup | { error: string };
  /** Replaces all device data with the backup in one write (keeps this device's profile id and backup bookkeeping). */
  restoreBackup(backup: ParsedBackup): Promise<void>;
  /** True when a backup is due: 30 days since the last backup (or since the profile was made) and not snoozed. */
  backupReminderDue(now?: Date): Promise<boolean>;
  /** Quiets the backup reminder for 30 days. */
  snoozeBackupReminder(now?: Date): Promise<void>;
}

/** What the device holds, shown before moving it to the new account. */
export interface UpgradeSummary {
  habits: number;
  checkIns: number;
  notes: number;
  moods: number;
}

export type UpgradeResult =
  | { ok: true; recoveryCode: string | null }
  /** `conflict`: the account already has habits (nothing changed); `consent`: the consent step is shown first; `failed`: try again. */
  | { ok: false; reason: 'conflict' | 'consent' | 'failed'; message: string };

export interface UpgradeApi {
  /** Null when there is no device data waiting. */
  summary(): Promise<UpgradeSummary | null>;
  /**
   * Uploads the device data into the signed-in account (`POST /api/me/import`), then removes the local copy and
   * leaves `upgrading` mode. With `privateJournal`, the journal is encrypted on the device before it is uploaded and
   * `recoveryCode` is the new journal's recovery code. Safe to call again after an interruption.
   */
  run(options?: { privateJournal?: { passphrase: string; remember: boolean; password?: string } }): Promise<UpgradeResult>;
}
