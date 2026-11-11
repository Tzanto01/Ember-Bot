import { type DayEdit, type NoteEdit, withDayEdit } from './device-store';
import { type Http, longRequestTimeoutMs } from './http';
import type {
  Credentials,
  DayEntry,
  DayNoteBody,
  DayStat,
  DeleteAccountRequest,
  EmailCode,
  ExportFormat,
  Habit,
  HabitPatch,
  HabitTemplate,
  JournalKey,
  JournalKeyPut,
  LocalDateString,
  Me,
  MePatch,
  MergePreview,
  MoodPatchBody,
  NewHabit,
  NewMoodBody,
  NewRoutine,
  PushSubscriptionRequest,
  ResetPasswordRequest,
  Routine,
  RoutinePatch,
  StoredDayNote,
  StoredMood,
  TwoFactorSetup,
  TwoFactorStatus,
  WeeklyStats,
} from './models';
import type { OfflineQueue } from './offline-queue';
import { asApiError } from './problem';

/** A downloaded export file. */
export interface ExportFile {
  blob: Blob;
  fileName: string;
}

const seg = encodeURIComponent;

/** `me` with a plain-journal `journal` when an API before v1.7 left it out. */
function withJournal(me: Me): Me {
  return me && !me.journal
    ? { ...me, journal: { encrypted: false, turningOff: false, plaintextLeft: 0, encryptedLeft: 0 } }
    : me;
}

/** No answer from the API: a network error (status 0), or the service worker's own 504 without a problem body. */
function unreachable(error: unknown): boolean {
  const apiError = asApiError(error);
  return apiError.status === 0 || (apiError.status === 504 && !apiError.problem);
}

function range(from?: LocalDateString, to?: LocalDateString): Record<string, string | undefined> {
  return { from: from || undefined, to: to || undefined };
}

/**
 * One method per endpoint of API contract v1. Every method returns a Promise and rejects with an
 * `ApiError` (see `problem.ts`); use `problemToMessage` for the copy. Session state lives in `AuthService`;
 * the client only remembers the habits it last saw, so a day edit made offline can be queued (contract
 * "Offline day edits") and answered optimistically.
 */
export class ApiClient {
  private readonly known = new Map<number, Habit>();

  constructor(
    private readonly http: Http,
    private readonly offline: OfflineQueue,
  ) {}

  private remember(habit: Habit): Habit {
    this.known.set(habit.id, habit);
    return habit;
  }

  /** `GET /api/auth/antiforgery`: sets the `XSRF-TOKEN` cookie. Prefer `AuthService.refreshAntiforgery()`. */
  antiforgery(): Promise<void> {
    return this.http.request('GET', '/api/auth/antiforgery');
  }

  /** `POST /api/auth/register`: 200 for any well-formed input, whether or not the address is taken. */
  register(body: Credentials): Promise<void> {
    return this.http.request('POST', '/api/auth/register', { body });
  }

  /**
   * `POST /api/auth/login` with `useCookies` (stay signed in) or `useSessionCookies`. Prefer `AuthService.login()`.
   * A right password without a needed code answers 401 `RequiresTwoFactor`; send `twoFactorCode` or
   * `twoFactorRecoveryCode` in `body` then.
   */
  login(body: Credentials, staySignedIn: boolean): Promise<void> {
    const params = { [staySignedIn ? 'useCookies' : 'useSessionCookies']: 'true' };
    return this.http.request('POST', '/api/auth/login', { body, params });
  }

  /** `POST /api/auth/confirmEmail` (v1.2): needs the password chosen at sign-up; 401 for a bad or expired code or a wrong password. */
  confirmEmail(userId: string, code: string, password: string): Promise<void> {
    return this.http.request('POST', '/api/auth/confirmEmail', {
      body: { userId, code, password },
    });
  }

  /**
   * `POST /api/auth/confirm-email-code?useCookies=true`: confirms the email with the emailed 6-digit code and signs the
   * browser in with the cookie. Send `email` or `userId`. Any failure is 401 `invalid_code`. Prefer
   * `AuthService.confirmEmailCode()`.
   */
  confirmEmailCode(body: EmailCode): Promise<void> {
    return this.http.request('POST', '/api/auth/confirm-email-code', { body, params: { useCookies: 'true' } });
  }

  /** `POST /api/auth/resendConfirmationEmail`: always 200. */
  resendConfirmationEmail(email: string): Promise<void> {
    return this.http.request('POST', '/api/auth/resendConfirmationEmail', { body: { email } });
  }

  /** `POST /api/auth/forgotPassword`: always 200. */
  forgotPassword(email: string): Promise<void> {
    return this.http.request('POST', '/api/auth/forgotPassword', { body: { email } });
  }

  /** `POST /api/auth/resetPassword`: 400 validation with Identity codes on failure. */
  resetPassword(body: ResetPasswordRequest): Promise<void> {
    return this.http.request('POST', '/api/auth/resetPassword', { body });
  }

  /** `POST /api/auth/logout`. Prefer `AuthService.logout()`. */
  logout(): Promise<void> {
    return this.http.request('POST', '/api/auth/logout');
  }

  /** `POST /api/auth/logout-everywhere`: ends every session on every device. Prefer `AuthService.logout(true)`. */
  logoutEverywhere(): Promise<void> {
    return this.http.request('POST', '/api/auth/logout-everywhere');
  }

  /** URL for a full-page navigation to Discord sign-in. `returnUrl` must already be a safe local path. */
  discordLoginUrl(returnUrl: string): string {
    return `/api/auth/discord/login?returnUrl=${seg(returnUrl)}`;
  }

  /** `POST /api/auth/discord/2fa`: finishes a Discord sign-in that ended on `/login?step=2fa`. */
  discordTwoFactor(body: { code?: string; recoveryCode?: string }): Promise<void> {
    return this.http.request('POST', '/api/auth/discord/2fa', { body });
  }

  /** `POST /api/auth/discord/link/start`: checks the password and allows one link from this browser for five minutes. */
  startDiscordLink(password: string): Promise<void> {
    return this.http.request('POST', '/api/auth/discord/link/start', { body: { password } });
  }

  /**
   * URL for a full-page navigation that links Discord to the signed-in account. An account with a password needs
   * `startDiscordLink` first, else it ends on `/settings?discord=password`.
   */
  discordLinkUrl(): string {
    return '/api/auth/discord/link';
  }

  /** `DELETE /api/me/discord`: 409 `conflict` without a password and confirmed email. */
  unlinkDiscord(): Promise<void> {
    return this.http.request('DELETE', '/api/me/discord');
  }

  /** `GET /api/account/merge`: 404 when no merge is pending. */
  getMergePreview(): Promise<MergePreview> {
    return this.http.request('GET', '/api/account/merge');
  }

  /** `POST /api/account/merge`: needs consent. */
  confirmMerge(): Promise<void> {
    return this.http.request('POST', '/api/account/merge');
  }

  /** `DELETE /api/account/merge`: cancels the pending merge. */
  cancelMerge(): Promise<void> {
    return this.http.request('DELETE', '/api/account/merge');
  }

  /** `GET /api/me`. Prefer `AuthService.me` for the cached value. */
  async getMe(): Promise<Me> {
    return withJournal(await this.http.request<Me>('GET', '/api/me'));
  }

  /** `PATCH /api/me`. Call `AuthService.setMe()` with the result. */
  async updateMe(patch: MePatch): Promise<Me> {
    return withJournal(await this.http.request<Me>('PATCH', '/api/me', { body: patch }));
  }

  /** `POST /api/me/consent`: 400 unless `policyVersion` is the current one. */
  giveConsent(policyVersion: string): Promise<void> {
    return this.http.request('POST', '/api/me/consent', { body: { policyVersion } });
  }

  /** `POST /api/me/dm-reminders/resume`. */
  resumeDmReminders(): Promise<void> {
    return this.http.request('POST', '/api/me/dm-reminders/resume');
  }

  /** `GET /api/me/export`: the file as a blob. Pass the result to `saveFile()`. */
  async exportData(format: ExportFormat): Promise<ExportFile> {
    const { blob, headers } = await this.http.download('/api/me/export', { format }, longRequestTimeoutMs);
    const disposition = headers.get('Content-Disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : `ember-export.${format}`;
    return { blob, fileName };
  }

  /**
   * `POST /api/me/import` (v1.7): moves device data (the JSON export format v2) into an account without habits. All or
   * nothing; 409 `conflict` when the account already has habits, 403 `consent_required` without consent.
   */
  importData(body: unknown): Promise<void> {
    return this.http.request('POST', '/api/me/import', { body, timeoutMs: longRequestTimeoutMs });
  }

  /** `POST /api/me/delete`: deletes everything and signs out. */
  deleteAccount(body: DeleteAccountRequest): Promise<void> {
    return this.http.request('POST', '/api/me/delete', { body, timeoutMs: longRequestTimeoutMs });
  }

  /** `GET /api/habits`. */
  async listHabits(): Promise<Habit[]> {
    const habits = await this.http.request<Habit[]>('GET', '/api/habits');
    return habits.map((habit) => this.remember(habit));
  }

  /** `GET /api/habits/{id}`. */
  async getHabit(id: number): Promise<Habit> {
    return this.remember(await this.http.request<Habit>('GET', `/api/habits/${id}`));
  }

  /** `POST /api/habits`: 409 `habit_limit`, 403 `consent_required`. */
  createHabit(body: NewHabit): Promise<Habit> {
    return this.http.request('POST', '/api/habits', { body });
  }

  /** `PATCH /api/habits/{id}`. */
  updateHabit(id: number, patch: HabitPatch): Promise<Habit> {
    return this.http.request('PATCH', `/api/habits/${id}`, { body: patch });
  }

  /** `DELETE /api/habits/{id}`. */
  deleteHabit(id: number): Promise<void> {
    return this.http.request('DELETE', `/api/habits/${id}`);
  }

  /** `POST /api/habits/{id}/pause`: `until` null resumes. */
  pauseHabit(id: number, until: LocalDateString | null): Promise<Habit> {
    return this.http.request('POST', `/api/habits/${id}/pause`, { body: { until } });
  }

  /** `GET /api/habits/{id}/days`, oldest first. Default: 14 days ending today; at most 366 per call. */
  getDays(id: number, from?: LocalDateString, to?: LocalDateString): Promise<DayEntry[]> {
    return this.http.request('GET', `/api/habits/${id}/days`, { params: range(from, to) });
  }

  /**
   * `PUT /api/habits/{id}/days/{date}` `{ count }` (v1.6, absolute, 0 to `timesPerDay`): sets a multi-count day.
   * Offline, the edit is queued and answered optimistically.
   */
  setDayCount(id: number, date: LocalDateString, count: number): Promise<Habit> {
    return this.dayEdit({ habitId: id, date, completed: null, count });
  }

  /** `PUT /api/habits/{id}/days/{date}`: check-in or backfill. Offline, the edit is queued and answered optimistically. */
  setDay(id: number, date: LocalDateString, completed: boolean): Promise<Habit> {
    return this.dayEdit({ habitId: id, date, completed });
  }

  /** `DELETE /api/habits/{id}/days/{date}`: clears the day. Offline, the edit is queued and answered optimistically. */
  clearDay(id: number, date: LocalDateString): Promise<Habit> {
    return this.dayEdit({ habitId: id, date, completed: null });
  }

  /** Sends one day edit (`completed` null clears) without the offline fallback; `replay` marks queue replays. */
  async sendDayEdit(edit: DayEdit, replay = false): Promise<Habit> {
    const url = `/api/habits/${edit.habitId}/days/${seg(edit.date)}`;
    const habit =
      edit.count !== undefined
        ? await this.http.request<Habit>('PUT', url, { body: { count: edit.count }, replay })
        : edit.completed === null
          ? await this.http.request<Habit>('DELETE', url, { replay })
          : await this.http.request<Habit>('PUT', url, {
              body: { completed: edit.completed },
              replay,
            });
    return this.remember(habit);
  }

  private async dayEdit(edit: DayEdit): Promise<Habit> {
    const known = this.known.get(edit.habitId);
    if (known && this.offline.pending.get() > 0 && (await this.offline.add(edit))) {
      return this.remember(withDayEdit(known, edit));
    }
    try {
      return await this.sendDayEdit(edit);
    } catch (error) {
      if (!unreachable(error) || !known || !(await this.offline.add(edit))) throw error;
      return this.remember(withDayEdit(known, edit));
    }
  }

  /** `GET /api/routines`. */
  listRoutines(): Promise<Routine[]> {
    return this.http.request('GET', '/api/routines');
  }

  /** `POST /api/routines`: 409 `conflict` at 10 routines; listing a habit moves it from its old routine. */
  createRoutine(body: NewRoutine): Promise<Routine> {
    return this.http.request('POST', '/api/routines', { body });
  }

  /** `PATCH /api/routines/{id}`. */
  updateRoutine(id: number, patch: RoutinePatch): Promise<Routine> {
    return this.http.request('PATCH', `/api/routines/${id}`, { body: patch });
  }

  /** `DELETE /api/routines/{id}`: its habits stay, ungrouped. */
  deleteRoutine(id: number): Promise<void> {
    return this.http.request('DELETE', `/api/routines/${id}`);
  }

  /** `GET /api/day-notes`, oldest first (default and maximum: 366 days). Entries may be encrypted. */
  listDayNotes(from?: LocalDateString, to?: LocalDateString): Promise<StoredDayNote[]> {
    return this.http.request('GET', '/api/day-notes', { params: range(from, to) });
  }

  /**
   * `PUT /api/day-notes/{date}` (body null: `DELETE`). Offline, the edit is queued and resolves `queued: true`;
   * pass an already encrypted body while the private journal is on.
   */
  async saveDayNote(
    date: LocalDateString,
    body: DayNoteBody | null,
  ): Promise<{ note: StoredDayNote | null; queued: boolean }> {
    const edit: NoteEdit = { kind: 'note', date, body };
    if (this.offline.pending.get() > 0 && (await this.offline.add(edit))) return { note: null, queued: true };
    try {
      return { note: await this.sendNoteEdit(edit), queued: false };
    } catch (error) {
      if (!unreachable(error) || !(await this.offline.add(edit))) throw error;
      return { note: null, queued: true };
    }
  }

  /** Sends one journal edit without the offline fallback; `replay` marks queue replays. */
  async sendNoteEdit(edit: NoteEdit, replay = false): Promise<StoredDayNote | null> {
    const url = `/api/day-notes/${seg(edit.date)}`;
    if (edit.body === null) {
      await this.http.request('DELETE', url, { replay });
      return null;
    }
    return this.http.request<StoredDayNote>('PUT', url, { body: edit.body, replay });
  }

  /** `GET /api/moods`: the user's own moods, archived ones included. Moods may be encrypted. */
  listMoods(): Promise<StoredMood[]> {
    return this.http.request('GET', '/api/moods');
  }

  /** `POST /api/moods`: 409 `conflict` at 20 non-archived moods. */
  createMood(body: NewMoodBody): Promise<StoredMood> {
    return this.http.request('POST', '/api/moods', { body });
  }

  /** `PATCH /api/moods/{id}` (archive instead of delete). */
  updateMood(id: number, patch: MoodPatchBody): Promise<StoredMood> {
    return this.http.request('PATCH', `/api/moods/${id}`, { body: patch });
  }

  /** `GET /api/stats/days`, oldest first (default: the 366 days ending today; at most 366). */
  dayStats(from?: LocalDateString, to?: LocalDateString): Promise<DayStat[]> {
    return this.http.request('GET', '/api/stats/days', { params: range(from, to) });
  }

  /** `GET /api/me/journal-key`: 404 while the private journal is off. */
  getJournalKey(): Promise<JournalKey> {
    return this.http.request('GET', '/api/me/journal-key');
  }

  /** `PUT /api/me/journal-key`: create (no `ifVersion`) or replace (409 `conflict` on a version mismatch). */
  putJournalKey(body: JournalKeyPut): Promise<JournalKey> {
    return this.http.request('PUT', '/api/me/journal-key', { body });
  }

  /** `POST /api/me/journal-key/turn-off`: keeps the key, accepts plaintext writes again until the key is deleted. */
  turnOffJournal(body: { password?: string }): Promise<void> {
    return this.http.request('POST', '/api/me/journal-key/turn-off', { body });
  }

  /** `DELETE /api/me/journal-key`: 409 `conflict` while encrypted data remains, unless `discardEncrypted`. */
  deleteJournalKey(body: { password?: string; discardEncrypted: boolean }): Promise<void> {
    return this.http.request('DELETE', '/api/me/journal-key', { body });
  }

  /** `GET /api/me/2fa`. */
  twoFactorStatus(): Promise<TwoFactorStatus> {
    return this.http.request('GET', '/api/me/2fa');
  }

  /** `POST /api/me/2fa/setup`: a new unconfirmed key (replaces an earlier unconfirmed one). */
  setupTwoFactor(): Promise<TwoFactorSetup> {
    return this.http.request('POST', '/api/me/2fa/setup');
  }

  /**
   * `POST /api/me/2fa/enable`: the ten recovery codes, shown once; wrong code → 400 on `code`. Accounts with a login
   * password send it (wrong or missing → 400 on `password`).
   */
  async enableTwoFactor(code: string, password?: string): Promise<string[]> {
    return (
      await this.http.request<{ recoveryCodes: string[] }>('POST', '/api/me/2fa/enable', { body: { code, password } })
    ).recoveryCodes;
  }

  /** `POST /api/me/2fa/disable`: the login password, or for Discord-only accounts a current code. */
  disableTwoFactor(body: { password?: string; code?: string }): Promise<void> {
    return this.http.request('POST', '/api/me/2fa/disable', { body });
  }

  /** `POST /api/me/2fa/recovery-codes`: ten new recovery codes, replacing the old ones. */
  async regenerateRecoveryCodes(code: string): Promise<string[]> {
    return (
      await this.http.request<{ recoveryCodes: string[] }>('POST', '/api/me/2fa/recovery-codes', { body: { code } })
    ).recoveryCodes;
  }

  /** `GET /api/habit-templates`. */
  listTemplates(): Promise<HabitTemplate[]> {
    return this.http.request('GET', '/api/habit-templates');
  }

  /** `GET /api/low-days`. Default: the last 366 days. */
  listLowDays(from?: LocalDateString, to?: LocalDateString): Promise<LocalDateString[]> {
    return this.http.request('GET', '/api/low-days', { params: range(from, to) });
  }

  /** `PUT /api/low-days/{date}`: 422 `in_future` / `before_habit_start`. */
  markLowDay(date: LocalDateString): Promise<void> {
    return this.http.request('PUT', `/api/low-days/${seg(date)}`);
  }

  /** `DELETE /api/low-days/{date}`. */
  clearLowDay(date: LocalDateString): Promise<void> {
    return this.http.request('DELETE', `/api/low-days/${seg(date)}`);
  }

  /** `GET /api/stats/weekly`: the 7 days ending yesterday. */
  weeklyStats(): Promise<WeeklyStats> {
    return this.http.request('GET', '/api/stats/weekly');
  }

  /** `GET /api/push/vapid-public-key`: 501 until the push slice lands (hide push settings then). */
  async getVapidPublicKey(): Promise<string> {
    const body = await this.http.request<{ key: string }>('GET', '/api/push/vapid-public-key');
    return body.key;
  }

  /** `POST /api/me/push-subscriptions`. */
  addPushSubscription(body: PushSubscriptionRequest): Promise<void> {
    return this.http.request('POST', '/api/me/push-subscriptions', { body });
  }

  /** `DELETE /api/me/push-subscriptions?endpoint=`: only the caller's own. */
  removePushSubscription(endpoint: string): Promise<void> {
    return this.http.request('DELETE', '/api/me/push-subscriptions', { params: { endpoint } });
  }
}

/** Saves a downloaded file through a temporary object URL. */
export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
