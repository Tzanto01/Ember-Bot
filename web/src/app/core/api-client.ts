import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
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

/** A downloaded export file. */
export interface ExportFile {
  blob: Blob;
  fileName: string;
}

const seg = encodeURIComponent;

function range(from?: LocalDateString, to?: LocalDateString): HttpParams {
  let params = new HttpParams();
  if (from) params = params.set('from', from);
  if (to) params = params.set('to', to);
  return params;
}

/**
 * One method per endpoint of API contract v1. Every method returns a Promise and rejects with an
 * `ApiError` (see `problem.ts`); use `problemToMessage` for the copy. Stateless: session state lives
 * in `AuthService`.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  private run<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(request);
  }

  /** `GET /api/auth/antiforgery`: sets the `XSRF-TOKEN` cookie. Prefer `AuthService.refreshAntiforgery()`. */
  antiforgery(): Promise<void> {
    return this.run(this.http.get<void>('/api/auth/antiforgery'));
  }

  /** `POST /api/auth/register`: 200 for any well-formed input, whether or not the address is taken. */
  register(body: Credentials): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/register', body));
  }

  /** `POST /api/auth/login` with `useCookies` (stay signed in) or `useSessionCookies`. Prefer `AuthService.login()`. */
  login(body: Credentials, staySignedIn: boolean): Promise<void> {
    const params = new HttpParams().set(staySignedIn ? 'useCookies' : 'useSessionCookies', 'true');
    return this.run(this.http.post<void>('/api/auth/login', body, { params }));
  }

  /** `POST /api/auth/confirmEmail` (v1.2): needs the password chosen at sign-up; 401 for a bad or expired code or a wrong password. */
  confirmEmail(userId: string, code: string, password: string): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/confirmEmail', { userId, code, password }));
  }

  /** `POST /api/auth/resendConfirmationEmail`: always 200. */
  resendConfirmationEmail(email: string): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/resendConfirmationEmail', { email }));
  }

  /** `POST /api/auth/forgotPassword`: always 200. */
  forgotPassword(email: string): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/forgotPassword', { email }));
  }

  /** `POST /api/auth/resetPassword`: 400 validation with Identity codes on failure. */
  resetPassword(body: ResetPasswordRequest): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/resetPassword', body));
  }

  /** `POST /api/auth/logout`. Prefer `AuthService.logout()`. */
  logout(): Promise<void> {
    return this.run(this.http.post<void>('/api/auth/logout', null));
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
    return this.run(this.http.delete<void>('/api/me/discord'));
  }

  /** `GET /api/account/merge`: 404 when no merge is pending. */
  getMergePreview(): Promise<MergePreview> {
    return this.run(this.http.get<MergePreview>('/api/account/merge'));
  }

  /** `POST /api/account/merge`: needs consent. */
  confirmMerge(): Promise<void> {
    return this.run(this.http.post<void>('/api/account/merge', null));
  }

  /** `DELETE /api/account/merge`: cancels the pending merge. */
  cancelMerge(): Promise<void> {
    return this.run(this.http.delete<void>('/api/account/merge'));
  }

  /** `GET /api/me`. Prefer `AuthService.me()` for the cached value. */
  getMe(): Promise<Me> {
    return this.run(this.http.get<Me>('/api/me'));
  }

  /** `PATCH /api/me`. Call `AuthService.setMe()` with the result. */
  updateMe(patch: MePatch): Promise<Me> {
    return this.run(this.http.patch<Me>('/api/me', patch));
  }

  /** `POST /api/me/consent`: 400 unless `policyVersion` is the current one. */
  giveConsent(policyVersion: string): Promise<void> {
    return this.run(this.http.post<void>('/api/me/consent', { policyVersion }));
  }

  /** `POST /api/me/dm-reminders/resume`. */
  resumeDmReminders(): Promise<void> {
    return this.run(this.http.post<void>('/api/me/dm-reminders/resume', null));
  }

  /** `GET /api/me/export`: the file as a blob. Pass the result to `saveFile()`. */
  async exportData(format: ExportFormat): Promise<ExportFile> {
    const response = await this.run(
      this.http.get('/api/me/export', { params: { format }, responseType: 'blob', observe: 'response' }),
    );
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : `ember-export.${format}`;
    return { blob: response.body ?? new Blob(), fileName };
  }

  /** `POST /api/me/delete`: deletes everything and signs out. */
  deleteAccount(body: DeleteAccountRequest): Promise<void> {
    return this.run(this.http.post<void>('/api/me/delete', body));
  }

  /** `GET /api/habits`. */
  listHabits(): Promise<Habit[]> {
    return this.run(this.http.get<Habit[]>('/api/habits'));
  }

  /** `GET /api/habits/{id}`. */
  getHabit(id: number): Promise<Habit> {
    return this.run(this.http.get<Habit>(`/api/habits/${id}`));
  }

  /** `POST /api/habits`: 409 `habit_limit`, 403 `consent_required`. */
  createHabit(body: NewHabit): Promise<Habit> {
    return this.run(this.http.post<Habit>('/api/habits', body));
  }

  /** `PATCH /api/habits/{id}`. */
  updateHabit(id: number, patch: HabitPatch): Promise<Habit> {
    return this.run(this.http.patch<Habit>(`/api/habits/${id}`, patch));
  }

  /** `DELETE /api/habits/{id}`. */
  deleteHabit(id: number): Promise<void> {
    return this.run(this.http.delete<void>(`/api/habits/${id}`));
  }

  /** `POST /api/habits/{id}/pause`: `until` null resumes. */
  pauseHabit(id: number, until: LocalDateString | null): Promise<Habit> {
    return this.run(this.http.post<Habit>(`/api/habits/${id}/pause`, { until }));
  }

  /** `GET /api/habits/{id}/days`, oldest first. Default: 14 days ending today; at most 366 per call. */
  getDays(id: number, from?: LocalDateString, to?: LocalDateString): Promise<DayEntry[]> {
    return this.run(this.http.get<DayEntry[]>(`/api/habits/${id}/days`, { params: range(from, to) }));
  }

  /** `PUT /api/habits/{id}/days/{date}`: check-in or backfill. */
  setDay(id: number, date: LocalDateString, completed: boolean): Promise<Habit> {
    return this.run(this.http.put<Habit>(`/api/habits/${id}/days/${seg(date)}`, { completed }));
  }

  /** `DELETE /api/habits/{id}/days/{date}`: clears the day. */
  clearDay(id: number, date: LocalDateString): Promise<Habit> {
    return this.run(this.http.delete<Habit>(`/api/habits/${id}/days/${seg(date)}`));
  }

  /** `GET /api/habit-templates`. */
  listTemplates(): Promise<HabitTemplate[]> {
    return this.run(this.http.get<HabitTemplate[]>('/api/habit-templates'));
  }

  /** `GET /api/low-days`. Default: the last 366 days. */
  listLowDays(from?: LocalDateString, to?: LocalDateString): Promise<LocalDateString[]> {
    return this.run(this.http.get<LocalDateString[]>('/api/low-days', { params: range(from, to) }));
  }

  /** `PUT /api/low-days/{date}`: 422 `in_future` / `before_habit_start`. */
  markLowDay(date: LocalDateString): Promise<void> {
    return this.run(this.http.put<void>(`/api/low-days/${seg(date)}`, null));
  }

  /** `DELETE /api/low-days/{date}`. */
  clearLowDay(date: LocalDateString): Promise<void> {
    return this.run(this.http.delete<void>(`/api/low-days/${seg(date)}`));
  }

  /** `GET /api/stats/weekly`: the 7 days ending yesterday. */
  weeklyStats(): Promise<WeeklyStats> {
    return this.run(this.http.get<WeeklyStats>('/api/stats/weekly'));
  }

  /** `GET /api/push/vapid-public-key`: 501 until the push slice lands (hide push settings then). */
  async getVapidPublicKey(): Promise<string> {
    const body = await this.run(this.http.get<{ key: string }>('/api/push/vapid-public-key'));
    return body.key;
  }

  /** `POST /api/me/push-subscriptions`. */
  addPushSubscription(body: PushSubscriptionRequest): Promise<void> {
    return this.run(this.http.post<void>('/api/me/push-subscriptions', body));
  }

  /** `DELETE /api/me/push-subscriptions?endpoint=`: only the caller's own. */
  removePushSubscription(endpoint: string): Promise<void> {
    return this.run(this.http.delete<void>('/api/me/push-subscriptions', { params: { endpoint } }));
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
