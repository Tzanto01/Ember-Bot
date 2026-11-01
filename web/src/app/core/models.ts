/** Typed shapes of the Ember API contract v1 (`docs/contracts/api-v1.md`). Dates are `yyyy-MM-dd`, times `HH:mm`. */

/** A local calendar day, `yyyy-MM-dd`. */
export type LocalDateString = string;

/** A local time of day, `HH:mm`. */
export type TimeOfDay = string;

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
  leaderboardOptIn: boolean;
  consent: { given: boolean; policyVersion: string | null; currentPolicyVersion: string };
  dmReminders: { paused: boolean };
}

/** `PATCH /api/me` body. */
export interface MePatch {
  timezone?: string;
  /** 0 to 3. */
  graceDaysPerWeek?: number;
  leaderboardOptIn?: boolean;
}

export type Frequency = 'daily' | 'weekly';

/** Core `DayState`. `notdone` is just an empty day, never "missed". */
export type DayState = 'beforestart' | 'done' | 'notdone' | 'pending' | 'lowday' | 'paused';

export type ReminderChannel = 'discord' | 'webpush' | 'mobile';

export interface DayEntry {
  date: LocalDateString;
  state: DayState;
  completed: boolean | null;
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
  reminderTime: TimeOfDay | null;
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
  frequency: Frequency;
  weeklyTarget?: number | null;
}

/** `PATCH /api/habits/{id}` body. */
export interface HabitPatch {
  name?: string;
  reminderTime?: TimeOfDay | null;
  clearReminder?: boolean;
  frequency?: Frequency;
  weeklyTarget?: number | null;
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
  kept: { timezone: string; graceDaysPerWeek: number; leaderboardOptIn: boolean };
}

/** `GET /api/stats/weekly`, the 7 days ending yesterday. */
export interface WeeklyStats {
  totalDone: number;
  totalPossible: number;
  headline: string;
  footer: string;
  habits: { habitId: number; name: string; done: number; possible: number; streak: number | null }[];
}

export interface Credentials {
  email: string;
  password: string;
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
