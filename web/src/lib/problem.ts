import { t } from './i18n';
import type { ProblemDetails } from './models';

/**
 * Every failed API call rejects with an `ApiError` (the error interceptor converts it).
 * `handled` is true when the interceptor already acted (session ended, consent redirect),
 * so the screen should stay quiet instead of showing a message.
 */
export class ApiError extends Error {
  constructor(
    /** HTTP status, 0 when the network failed. */
    readonly status: number,
    readonly problem: ProblemDetails | null,
    /** Seconds from `Retry-After` on 429, else null. */
    readonly retryAfterSeconds: number | null = null,
    public handled = false,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }

  /** The contract's problem `type` code, when present. */
  get type(): string | null {
    return this.problem?.type ?? null;
  }
}

/**
 * Converts a failed HTTP response into an `ApiError`.
 * `body` is the parsed JSON body or null; a non-object body carries no problem.
 * `Retry-After` is read from `headers` when present.
 */
export function toApiError(status: number, body: unknown, headers?: Headers | null): ApiError {
  const problem = body && typeof body === 'object' ? (body as ProblemDetails) : null;
  const retry = Number.parseInt(headers?.get('Retry-After') ?? '', 10);
  return new ApiError(status, problem, Number.isFinite(retry) ? retry : null);
}

/** Normalises anything thrown by an API call into an `ApiError`; a network failure, an abort or anything unknown becomes status 0. */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, null);
}

/** True for the login's 401 `RequiresTwoFactor`: the password was right, the authenticator code is still needed. */
export function requiresTwoFactor(error: unknown): boolean {
  const apiError = asApiError(error);
  return apiError.status === 401 && apiError.problem?.detail === 'RequiresTwoFactor';
}

/** Which screen is asking: login and email-link failures are form errors, never a session expiry. */
export type ProblemContext = 'general' | 'login' | 'register' | 'confirm-email' | 'email-code' | 'reset-password';

/** A gentle, user-facing reading of a failed call. */
export interface FriendlyProblem {
  /** One calm sentence or two for a notice. */
  message: string;
  /** Field name (camelCase, for example `email`, `password`, `name`) to message. */
  fields: Record<string, string>;
  /** Show a "send the confirmation link again" action. */
  offerResend: boolean;
}

const identityCodes: Record<string, { field: string; key: ErrorKey }> = {
  PasswordTooShort: { field: 'password', key: 'errors.password.tooShort' },
  PasswordRequiresDigit: { field: 'password', key: 'errors.password.mix' },
  PasswordRequiresLower: { field: 'password', key: 'errors.password.mix' },
  PasswordRequiresUpper: { field: 'password', key: 'errors.password.mix' },
  PasswordRequiresNonAlphanumeric: { field: 'password', key: 'errors.password.mix' },
  PasswordRequiresUniqueChars: { field: 'password', key: 'errors.password.uniqueChars' },
  PasswordMismatch: { field: 'password', key: 'errors.password.mismatch' },
  InvalidEmail: { field: 'email', key: 'errors.email.invalid' },
  InvalidUserName: { field: 'email', key: 'errors.email.invalid' },
  DuplicateUserName: { field: 'email', key: 'errors.email.taken' },
  DuplicateEmail: { field: 'email', key: 'errors.email.taken' },
};

type ErrorKey =
  | 'errors.password.tooShort'
  | 'errors.password.mix'
  | 'errors.password.uniqueChars'
  | 'errors.password.mismatch'
  | 'errors.email.invalid'
  | 'errors.email.taken';

function fieldKey(key: string): string {
  const bare = key.replace(/^\$\./, '').split('.').pop() ?? key;
  return bare.charAt(0).toLowerCase() + bare.slice(1);
}

function tooManyText(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return t('errors.tooMany');
  if (seconds < 90) return t('errors.tooMany.seconds', { count: seconds });
  return t('errors.tooMany.minutes', { count: Math.ceil(seconds / 60) });
}

/**
 * Maps a failed call to gentle copy. Pure: no navigation, no state.
 * Login 401 (`Failed`, `NotAllowed`, `RequiresTwoFactor`), confirm-email and email-code 401 are form errors here.
 */
export function problemToMessage(
  error: ApiError,
  context: ProblemContext = 'general',
): FriendlyProblem {
  const result: FriendlyProblem = { message: '', fields: {}, offerResend: false };
  const problem = error.problem;
  const detail = problem?.detail;

  switch (error.status) {
    case 0:
      result.message = t('errors.network');
      return result;
    case 400: {
      for (const [key, messages] of Object.entries(problem?.errors ?? {})) {
        const identity = identityCodes[key];
        if (key === 'InvalidToken') {
          result.message = t('errors.expiredLink');
        } else if (identity) {
          result.fields[identity.field] ??= t(identity.key);
        } else if (key.startsWith('Password')) {
          result.fields['password'] ??= messages[0] ?? t('errors.password.different');
        } else {
          result.fields[fieldKey(key)] ??= messages.join(' ');
        }
      }
      if (!result.message) {
        result.message = Object.keys(result.fields).length
          ? t('errors.fieldsInvalid')
          : (detail ?? t('errors.requestInvalid'));
      }
      return result;
    }
    case 401:
      if (context === 'login') {
        if (detail === 'NotAllowed') {
          result.message = t('errors.login.notConfirmed');
          result.offerResend = true;
        } else if (detail === 'RequiresTwoFactor') {
          result.message = t('errors.login.twoFactor');
        } else {
          result.message = t('errors.login.failed');
        }
      } else if (context === 'confirm-email') {
        result.message = t('errors.confirm.failed');
        result.offerResend = true;
      } else if (context === 'email-code') {
        result.message =
          error.type === 'password_required'
            ? t('errors.code.passwordRequired')
            : t('errors.code.wrong');
      } else if (context === 'reset-password') {
        result.message = t('errors.expiredLink');
      } else {
        result.message = t('errors.session');
      }
      return result;
    case 403:
      result.message =
        error.type === 'consent_required'
          ? t('errors.consentRequired')
          : error.type === 'antiforgery'
            ? t('errors.antiforgery')
            : t('errors.forbidden');
      return result;
    case 404:
      result.message = t('errors.notFound');
      return result;
    case 409:
      result.message =
        error.type === 'habit_limit'
          ? t('errors.habitLimit')
          : (detail ?? t('errors.conflict'));
      return result;
    case 413:
      result.message = t('errors.tooLarge');
      return result;
    case 422:
      result.message =
        error.type === 'in_future'
          ? t('errors.day.inFuture')
          : error.type === 'before_habit_start'
            ? t('errors.day.beforeStart')
            : t('errors.day.outOfRange');
      return result;
    case 429:
      result.message = tooManyText(error.retryAfterSeconds);
      return result;
    case 501:
      result.message = t('errors.notYet');
      return result;
    default:
      result.message =
        error.status >= 500
          ? t('errors.server')
          : t('errors.unknown');
      return result;
  }
}
