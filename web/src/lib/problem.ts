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

const identityCodes: Record<string, { field: string; text: string }> = {
  PasswordTooShort: { field: 'password', text: 'Use at least 10 characters.' },
  PasswordRequiresDigit: {
    field: 'password',
    text: 'That password needs a different mix. A longer phrase works well.',
  },
  PasswordRequiresLower: {
    field: 'password',
    text: 'That password needs a different mix. A longer phrase works well.',
  },
  PasswordRequiresUpper: {
    field: 'password',
    text: 'That password needs a different mix. A longer phrase works well.',
  },
  PasswordRequiresNonAlphanumeric: {
    field: 'password',
    text: 'That password needs a different mix. A longer phrase works well.',
  },
  PasswordRequiresUniqueChars: {
    field: 'password',
    text: 'Try a password with a few more different characters.',
  },
  PasswordMismatch: { field: 'password', text: "That password didn't match. Try again." },
  InvalidEmail: { field: 'email', text: "That doesn't look like an email address yet." },
  InvalidUserName: { field: 'email', text: "That doesn't look like an email address yet." },
  DuplicateUserName: {
    field: 'email',
    text: 'That address is already in use. Try signing in instead.',
  },
  DuplicateEmail: {
    field: 'email',
    text: 'That address is already in use. Try signing in instead.',
  },
};

const expiredLink = 'This link has expired or was already used. You can ask for a fresh one.';

function fieldKey(key: string): string {
  const bare = key.replace(/^\$\./, '').split('.').pop() ?? key;
  return bare.charAt(0).toLowerCase() + bare.slice(1);
}

function waitText(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return 'Please try again in a little while.';
  if (seconds < 90) return `Please try again in about ${seconds} seconds.`;
  return `Please try again in about ${Math.ceil(seconds / 60)} minutes.`;
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
      result.message = "Ember can't be reached right now. Check your connection and try again.";
      return result;
    case 400: {
      for (const [key, messages] of Object.entries(problem?.errors ?? {})) {
        const identity = identityCodes[key];
        if (key === 'InvalidToken') {
          result.message = expiredLink;
        } else if (identity) {
          result.fields[identity.field] ??= identity.text;
        } else if (key.startsWith('Password')) {
          result.fields['password'] ??= messages[0] ?? 'Please choose a different password.';
        } else {
          result.fields[fieldKey(key)] ??= messages.join(' ');
        }
      }
      if (!result.message) {
        result.message = Object.keys(result.fields).length
          ? 'A few details need another look.'
          : (detail ?? 'Something in that request needs another look.');
      }
      return result;
    }
    case 401:
      if (context === 'login') {
        if (detail === 'NotAllowed') {
          result.message =
            "Your email isn't confirmed yet. Check your inbox, or we can send the link again.";
          result.offerResend = true;
        } else if (detail === 'RequiresTwoFactor') {
          result.message = 'Enter the code from your authenticator app to finish signing in.';
        } else {
          result.message =
            "That email and password don't match. Try again, or reset your password.";
        }
      } else if (context === 'confirm-email') {
        result.message =
          "That link or password didn't work. Check the password you chose when you signed up, or reset it.";
        result.offerResend = true;
      } else if (context === 'email-code') {
        result.message = "That code didn't work. Check the newest email or send a new code.";
      } else if (context === 'reset-password') {
        result.message = expiredLink;
      } else {
        result.message = 'Your session ended. Please sign in again.';
      }
      return result;
    case 403:
      result.message =
        error.type === 'consent_required'
          ? 'Ember needs your OK before it saves habits and check-ins.'
          : error.type === 'antiforgery'
            ? 'Something got out of sync. Reload the page and try again.'
            : "That isn't available for your account.";
      return result;
    case 404:
      result.message = "We couldn't find that. It may have been removed.";
      return result;
    case 409:
      result.message =
        error.type === 'habit_limit'
          ? 'You have 25 habits, the most Ember keeps. Remove one you no longer need to make room.'
          : (detail ?? "That couldn't be done right now.");
      return result;
    case 422:
      result.message =
        error.type === 'in_future'
          ? "That day hasn't happened yet."
          : error.type === 'before_habit_start'
            ? 'That day is before this habit started.'
            : 'That day is outside the range you can edit.';
      return result;
    case 429:
      result.message = `That was a lot of tries in a short time. ${waitText(error.retryAfterSeconds)}`;
      return result;
    case 501:
      result.message = "This isn't available yet.";
      return result;
    default:
      result.message =
        error.status >= 500
          ? 'Something went wrong on our side. Please try again in a moment.'
          : 'Something went wrong. Please try again.';
      return result;
  }
}
