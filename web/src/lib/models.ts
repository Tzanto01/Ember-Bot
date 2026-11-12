/** Typed shapes of the Ember API contract v1 (`docs/contracts/api-v1.md`). Dates are `yyyy-MM-dd`, times `HH:mm`. */

import type { ThemeId } from './theme';

/** A local calendar day, `yyyy-MM-dd`. */
export type LocalDateString = string;

/** A local time of day, `HH:mm`. */
export type TimeOfDay = string;

/** A habit's reminder times: `reminderTimes`, or its single `reminderTime` from servers that don't send them. */
export function reminderTimesOf(habit: { reminderTime: TimeOfDay | null; reminderTimes?: TimeOfDay[] }): TimeOfDay[] {
  return habit.reminderTimes ?? (habit.reminderTime ? [habit.reminderTime] : []);
}

/** `GET /api/me`. */
export interface Me {
  id: string;
  /** Null for accounts created through Discord. */
  email: string | null;
  emailConfirmed: boolean;
  hasPassword: boolean;
  discord: { linked: boolean; id: string | null };
  /** IANA zone, for example `Europe/Berlin`. */
  timezone: string;
  timezoneSet: boolean;
  /** The user's local today. Use this, never the browser clock, for data. */
  localToday: LocalDateString;
  graceDaysPerWeek: number;
  /** v1.8: minutes after a reminder for one more nudge; 0 is off. */
  secondReminderMinutes: SecondReminderMinutes;
  /** The account's theme id; null when never chosen (the app shows the default). */
  theme: ThemeId | null;
  consent: { given: boolean; policyVersion: string | null; currentPolicyVersion: string };
  dmReminders: { paused: boolean };
  /**
   * v1.7 private journal: `encrypted` once a journal key exists; `turningOff` while a switch-off is under way;
   * `plaintextLeft` / `encryptedLeft` entries and moods still to encrypt / decrypt.
   */
  journal: { encrypted: boolean; turningOff: boolean; plaintextLeft: number; encryptedLeft: number };
}

/** `PATCH /api/me` body. */
export interface MePatch {
  timezone?: string;
  /** 0 to 3. */
  graceDaysPerWeek?: number;
  theme?: ThemeId;
  secondReminderMinutes?: SecondReminderMinutes;
}

/** The `secondReminderMinutes` choices; 0 is off. */
export const secondReminderChoices = [0, 15, 30, 60, 120] as const;
export type SecondReminderMinutes = (typeof secondReminderChoices)[number];

export type Frequency = 'daily' | 'weekly' | 'weekdays';

/** A weekday key, Monday first. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Every weekday, Monday first (the order the API returns `days` in). */
export const weekdays: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Core `DayState`. `notdone` is just an empty day, never "missed". `offday` is a day outside a `weekdays`
 * schedule (rest, never missed); `partial` is a multi-count day with `0 < count < timesPerDay`.
 */
export type DayState =
  | 'beforestart'
  | 'done'
  | 'notdone'
  | 'pending'
  | 'lowday'
  | 'paused'
  | 'offday'
  | 'partial';

export type ReminderChannel = 'discord' | 'webpush' | 'mobile';

export interface DayEntry {
  date: LocalDateString;
  state: DayState;
  completed: boolean | null;
  /** Check-ins that day, 0 to `timesPerDay`. */
  count: number;
}

export interface HabitStats {
  /** Null for weekly habits. */
  streak: number | null;
  graceUsed: number | null;
  bestStreak: number | null;
  last7: number;
  /** Null for daily habits. */
  week: { done: number; target: number } | null;
}

export interface Habit {
  id: number;
  name: string;
  frequency: Frequency;
  /** 1 to 6 for weekly habits, else null. */
  weeklyTarget: number | null;
  /** 1 to 6 distinct weekdays, Monday first, for `weekdays` habits; else null. */
  days: Weekday[] | null;
  /** 1 to 10 check-ins a day for `daily` and `weekdays`; always 1 for `weekly`. */
  timesPerDay: number;
  /** The routine this habit belongs to, or null. */
  routineId: number | null;
  /** The first of `reminderTimes`, or null. */
  reminderTime: TimeOfDay | null;
  /** Sorted, unique, 0 to `timesPerDay`; absent from servers before multi-time reminders. */
  reminderTimes?: TimeOfDay[];
  pausedFrom: LocalDateString | null;
  pausedUntil: LocalDateString | null;
  pausedToday: boolean;
  createdAt: string;
  startDate: LocalDateString;
  today: DayEntry;
  stats: HabitStats;
  /** Absent until the push slice lands. Empty means no reminders. */
  reminderChannels?: ReminderChannel[];
}

/** `POST /api/habits` body. */
export interface NewHabit {
  /** 1 to 100 characters after trimming. */
  name: string;
  reminderTime?: TimeOfDay | null;
  /** Wins over `reminderTime` when present. */
  reminderTimes?: TimeOfDay[];
  reminderChannels?: ReminderChannel[];
  frequency: Frequency;
  weeklyTarget?: number | null;
  days?: Weekday[] | null;
  timesPerDay?: number;
}

/** `PATCH /api/habits/{id}` body. */
export interface HabitPatch {
  name?: string;
  reminderTime?: TimeOfDay | null;
  /** Wins over `reminderTime` when present; empty clears the reminder. */
  reminderTimes?: TimeOfDay[];
  clearReminder?: boolean;
  frequency?: Frequency;
  weeklyTarget?: number | null;
  days?: Weekday[] | null;
  timesPerDay?: number;
  reminderChannels?: ReminderChannel[];
}

/** `GET /api/habit-templates` item. `name` includes its emoji. */
export interface HabitTemplate {
  key: string;
  name: string;
  description: string;
  suggestedReminderTime: TimeOfDay;
  frequency: Frequency;
  weeklyTarget: number | null;
}

/** `GET /api/account/merge`. `kept` are the signed-in account's settings, which win. */
export interface MergePreview {
  habits: number;
  logs: number;
  dayMarks: number;
  habitNames: string[];
  kept: { timezone: string; graceDaysPerWeek: number };
}

/** `GET /api/stats/weekly`, the 7 days ending yesterday. */
export interface WeeklyStats {
  totalDone: number;
  totalPossible: number;
  headline: string;
  footer: string;
  habits: {
    habitId: number;
    name: string;
    done: number;
    possible: number;
    streak: number | null;
  }[];
}

export interface Credentials {
  email: string;
  password: string;
  /** v1.7: the authenticator code, after a `RequiresTwoFactor` answer. */
  twoFactorCode?: string;
  /** v1.7: one of the recovery codes instead of `twoFactorCode`. */
  twoFactorRecoveryCode?: string;
}

/**
 * `POST /api/auth/confirm-email-code` body: the emailed 6-digit code with the account's email or user id, the sign-up
 * key of this device when it has one, and the password when the server asked for it (`password_required`).
 */
export type EmailCode = ({ email: string; userId?: never } | { userId: string; email?: never }) & {
  code: string;
  signupKey?: string;
  password?: string;
};

/** `Routine` (v1.6). `habitIds` is ordered and sets membership. */
export interface Routine {
  id: number;
  name: string;
  reminderTime: TimeOfDay | null;
  reminderChannels: ReminderChannel[];
  habitIds: number[];
}

/** `POST /api/routines` body. */
export interface NewRoutine {
  /** 1 to 50 characters after trimming. */
  name: string;
  reminderTime?: TimeOfDay | null;
  reminderChannels?: ReminderChannel[];
  habitIds?: number[];
}

/** `PATCH /api/routines/{id}` body. */
export interface RoutinePatch {
  name?: string;
  reminderTime?: TimeOfDay | null;
  clearReminder?: boolean;
  reminderChannels?: ReminderChannel[];
  habitIds?: number[];
}

/** The five built-in moods, lowest first. */
export type BuiltinMood = 'low' | 'meh' | 'okay' | 'good' | 'great';

export const builtinMoods: readonly BuiltinMood[] = ['low', 'meh', 'okay', 'good', 'great'];

/** A built-in mood key or `custom:<id>` for one of the user's own moods. */
export type MoodKey = BuiltinMood | `custom:${number}`;

/** v1.7 ciphertext (all base64): AES-GCM `ct` with its 12-byte `iv`. */
export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
}

/** The journal for one local day, as plaintext. `text` 1 to 2000 characters after trimming, line breaks kept. */
export interface DayNote {
  date: LocalDateString;
  text: string | null;
  mood: MoodKey | null;
}

/** A day note as the API returns it: plaintext, or (private journal) only the ciphertext. */
export type StoredDayNote = DayNote | { date: LocalDateString; encrypted: EncryptedBlob };

/** `PUT /api/day-notes/{date}` body: plaintext, or `{ encrypted }` while a journal key exists. */
export type DayNoteBody = { text?: string | null; mood?: MoodKey | null } | { encrypted: EncryptedBlob };

/** One of the user's own moods, as plaintext. Archived moods leave the picker but past days keep them. */
export interface OwnMood {
  id: number;
  /** 1 to 24 characters after trimming. */
  label: string;
  /** One emoji grapheme, or null. */
  emoji: string | null;
  archived: boolean;
}

/** An own mood as the API returns it: plaintext, or (private journal) only the ciphertext. */
export type StoredMood = OwnMood | { id: number; encrypted: EncryptedBlob; archived: boolean };

/** `POST /api/moods` body. */
export type NewMoodBody = { label: string; emoji?: string | null } | { encrypted: EncryptedBlob };

/** `PATCH /api/moods/{id}` body. */
export type MoodPatchBody =
  | { label?: string; emoji?: string | null; archived?: boolean }
  | { encrypted?: EncryptedBlob; archived?: boolean };

/** `GET /api/stats/days` item: one local day across all habits. */
export interface DayStat {
  date: LocalDateString;
  scheduled: number;
  done: number;
  partial: number;
  /** Any check-in that day (offdays included). */
  showedUp: boolean;
}

/** `GET /api/me/journal-key` (binary fields base64). */
export interface JournalKey {
  version: number;
  /** True after `POST /api/me/journal-key/turn-off`: plaintext writes are accepted again until the key is deleted. */
  turningOff?: boolean;
  passphrase: { salt: string; iterations: number; iv: string; wrapped: string };
  recovery: { salt: string; iv: string; wrapped: string };
}

/** `PUT /api/me/journal-key` body. `ifVersion` when replacing; `password` when the account has one. */
export interface JournalKeyPut {
  passphrase: JournalKey['passphrase'];
  recovery: JournalKey['recovery'];
  password?: string;
  ifVersion?: number;
}

/** `GET /api/me/2fa`. */
export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

/** `POST /api/me/2fa/setup`. */
export interface TwoFactorSetup {
  sharedKey: string;
  /** `otpauth://` URI, issuer `Ember`. */
  authenticatorUri: string;
}

export interface ResetPasswordRequest {
  email: string;
  resetCode: string;
  newPassword: string;
}

/** `POST /api/me/delete`. `password` when the account has one, else `confirm: "DELETE"`. */
export interface DeleteAccountRequest {
  password?: string;
  confirm: 'DELETE';
}

/** `POST /api/me/push-subscriptions` body (same shape as `PushSubscription.toJSON()`). */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `POST /api/feedback` body (v1.14): `version` only when the app knows it. */
export interface FeedbackRequest {
  /** v1.14: required, trimmed, 1-100 characters, one line. */
  title: string;
  /** The description, 1-2000 characters. */
  text: string;
  platform: 'web' | 'android';
  version?: string;
  /** v1.14, signed in only: up to 5 pictures, 10 MiB decoded in total, each a plain base64 string (no `data:` prefix). */
  images?: string[];
  /** v1.14, signed in only: true sends the report without the account. */
  anonymous?: boolean;
}

export type ExportFormat = 'json' | 'csv';

/** Problem type codes from the contract. Identity endpoints may send other `type` values. */
export type ProblemType =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'consent_required'
  | 'antiforgery'
  | 'not_found'
  | 'habit_limit'
  | 'conflict'
  | 'before_habit_start'
  | 'in_future'
  | 'rate_limited'
  | 'internal';

/** RFC 7807 problem details as sent by the API. */
export interface ProblemDetails {
  type?: ProblemType | string;
  title?: string;
  status?: number;
  detail?: string;
  /** Field name (or Identity error code) to messages. */
  errors?: Record<string, string[]>;
}
