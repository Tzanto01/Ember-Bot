import { type DayEdit, withDayEdit } from './device-store';
import type { Http } from './http';
import type {
  Credentials,
  DayEntry,
  DeleteAccountRequest,
  ExportFormat,
  Habit,
  HabitPatch,
  HabitTemplate,
  LocalDateString,
  Me,
  MePatch,
  MergePreview,
  NewHabit,
  PushSubscriptionRequest,
  ResetPasswordRequest,
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

  /** `POST /api/auth/login` with `useCookies` (stay signed in) or `useSessionCookies`. Prefer `AuthService.login()`. */
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

  /** URL for a full-page navigation to Discord sign-in. `returnUrl` must already be a safe local path. */
  discordLoginUrl(returnUrl: string): string {
    return `/api/auth/discord/login?returnUrl=${seg(returnUrl)}`;
  }

  /** URL for a full-page navigation that links Discord to the signed-in account. */
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
  getMe(): Promise<Me> {
    return this.http.request('GET', '/api/me');
  }

  /** `PATCH /api/me`. Call `AuthService.setMe()` with the result. */
  updateMe(patch: MePatch): Promise<Me> {
    return this.http.request('PATCH', '/api/me', { body: patch });
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
    const { blob, headers } = await this.http.download('/api/me/export', { format });
    const disposition = headers.get('Content-Disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : `ember-export.${format}`;
    return { blob, fileName };
  }

  /** `POST /api/me/delete`: deletes everything and signs out. */
  deleteAccount(body: DeleteAccountRequest): Promise<void> {
    return this.http.request('POST', '/api/me/delete', { body });
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
      edit.completed === null
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
