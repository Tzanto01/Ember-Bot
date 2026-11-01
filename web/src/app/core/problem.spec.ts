import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ProblemDetails } from './models';
import { ApiError, problemToMessage, toApiError } from './problem';

const err = (status: number, problem: ProblemDetails | null = null, retry: number | null = null) =>
  new ApiError(status, problem, retry);

describe('problemToMessage', () => {
  describe('401', () => {
    it('treats login failures as form messages, different from a general session end', () => {
      const general = problemToMessage(err(401, { type: 'unauthenticated' }));
      const failed = problemToMessage(err(401, { detail: 'Failed' }), 'login');
      const locked = problemToMessage(err(401, { detail: 'LockedOut' }), 'login');
      const notAllowed = problemToMessage(err(401, { detail: 'NotAllowed' }), 'login');

      expect(
        new Set([general.message, failed.message, locked.message, notAllowed.message]).size,
      ).toBe(4);
      expect(failed.offerResend).toBe(false);
      expect(locked.offerResend).toBe(false);
      expect(general.offerResend).toBe(false);
    });

    it('offers to resend the confirmation link only for an unconfirmed login', () => {
      expect(problemToMessage(err(401, { detail: 'NotAllowed' }), 'login').offerResend).toBe(true);
    });

    it('reads a bad confirm-email link as an expired link with a resend, and a bad reset link without one', () => {
      const confirm = problemToMessage(err(401), 'confirm-email');
      const reset = problemToMessage(err(401), 'reset-password');
      expect(confirm.offerResend).toBe(true);
      expect(reset.offerResend).toBe(false);
      expect(confirm.message).toBe(reset.message);
      expect(confirm.message).not.toBe(problemToMessage(err(401)).message);
    });
  });

  describe('400', () => {
    it('maps Identity codes to the password and email fields', () => {
      const result = problemToMessage(
        err(400, {
          errors: { PasswordTooShort: ['x'], InvalidEmail: ['y'], DuplicateEmail: ['z'] },
        }),
        'register',
      );
      expect(Object.keys(result.fields).sort()).toEqual(['email', 'password']);
      expect(result.fields['password']).toBeTruthy();
      expect(result.fields['email']).toBeTruthy();
    });

    it('maps an unknown Password* code to the password field using the server message', () => {
      const result = problemToMessage(
        err(400, { errors: { PasswordSomethingNew: ['Pick another one.'] } }),
      );
      expect(result.fields['password']).toBe('Pick another one.');
    });

    it('turns InvalidToken into an expired-link message without a field', () => {
      const result = problemToMessage(
        err(400, { errors: { InvalidToken: ['bad'] } }),
        'reset-password',
      );
      expect(result.fields).toEqual({});
      expect(result.message).toBe(problemToMessage(err(401), 'reset-password').message);
    });

    it('maps contract validation field names to camelCase fields with the server messages', () => {
      const result = problemToMessage(
        err(400, {
          type: 'validation',
          errors: { Name: ['Too long.', 'Needed.'], '$.TargetPerWeek': ['Bad.'] },
        }),
      );
      expect(result.fields['name']).toContain('Too long.');
      expect(result.fields['name']).toContain('Needed.');
      expect(result.fields['targetPerWeek']).toBe('Bad.');
    });

    it('falls back to the detail when there are no field errors', () => {
      expect(problemToMessage(err(400, { detail: 'Policy version is stale.' })).message).toContain(
        'Policy version is stale.',
      );
    });
  });

  it('puts the Retry-After seconds into the 429 message', () => {
    expect(problemToMessage(err(429, null, 30)).message).toContain('30');
  });

  it('switches 429 to minutes for long waits and stays generic without a header', () => {
    expect(problemToMessage(err(429, null, 600)).message).toContain('10');
    expect(problemToMessage(err(429, null, 600)).message).not.toContain('600');
    expect(problemToMessage(err(429, null, null)).message).not.toMatch(/\d/);
  });

  it('surfaces the detail of a 409 conflict and a distinct message for habit_limit', () => {
    const conflict = problemToMessage(
      err(409, { type: 'conflict', detail: 'Set a password first.' }),
    );
    const limit = problemToMessage(err(409, { type: 'habit_limit', detail: 'ignored detail' }));
    expect(conflict.message).toContain('Set a password first.');
    expect(limit.message).not.toContain('ignored detail');
    expect(limit.message).toContain('25');
  });

  it('gives 422 in_future, before_habit_start and other reasons different messages', () => {
    const messages = [
      problemToMessage(err(422, { type: 'in_future' })).message,
      problemToMessage(err(422, { type: 'before_habit_start' })).message,
      problemToMessage(err(422, { type: 'too_old' })).message,
    ];
    expect(new Set(messages).size).toBe(3);
  });

  it('distinguishes consent_required and antiforgery on 403', () => {
    const consent = problemToMessage(err(403, { type: 'consent_required' })).message;
    const forgery = problemToMessage(err(403, { type: 'antiforgery' })).message;
    const plain = problemToMessage(err(403)).message;
    expect(new Set([consent, forgery, plain]).size).toBe(3);
  });

  it('describes a network failure and a server failure differently', () => {
    expect(problemToMessage(err(0)).message).not.toBe(problemToMessage(err(500)).message);
  });
});

describe('toApiError', () => {
  it('carries status, problem body and Retry-After seconds', () => {
    const response = new HttpErrorResponse({
      status: 429,
      error: { type: 'rate_limited', detail: 'Slow down' },
      headers: new HttpHeaders({ 'Retry-After': '42' }),
    });
    const error = toApiError(response);
    expect(error.status).toBe(429);
    expect(error.type).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.handled).toBe(false);
  });

  it('ignores a non-object body and a missing Retry-After', () => {
    const error = toApiError(new HttpErrorResponse({ status: 502, error: 'Bad gateway' }));
    expect(error.problem).toBeNull();
    expect(error.type).toBeNull();
    expect(error.retryAfterSeconds).toBeNull();
  });
});
