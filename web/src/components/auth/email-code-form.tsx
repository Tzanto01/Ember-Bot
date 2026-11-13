import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { type NavigateFunction, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { peekSignupKey, takeSignupEmail } from '@/components/auth/signup-email';
import { email as emailRule, required, useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { EmailCode, Me } from '@/lib/models';
import { type ApiError, asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';

const codeRule: Validator = (value) => {
  if (!value) return t('auth.code.required');
  return /^\d{6}$/.test(value) ? null : t('auth.code.digits');
};

const passwordRequired = (error: ApiError | null) => error?.status === 401 && error.type === 'password_required';

/** After a code sign-in: forgets the kept sign-up address and goes to consent or Today (sign-in when `me` didn't load). */
export function continueAfterCode(navigate: NavigateFunction, me: Me | null): void {
  takeSignupEmail();
  if (!me) void navigate('/login');
  else void navigate(auth.needsConsent() ? '/consent?returnUrl=%2Ftoday' : '/today');
}

export interface EmailCodeFormProps {
  /** The address the code went to; when null (and no `userId`), the form asks for it. */
  email: string | null;
  /** The account from the email link; confirms without asking for the address. */
  userId?: string | null;
  /** The code from the email link, filled in when the server only asked for the password. */
  code?: string | null;
  /** A failed confirmation that happened before the form showed, for example from the email link. */
  initialError?: unknown;
}

/**
 * The emailed 6-digit code: submits on the sixth digit (or the button) with this device's sign-up key, signs in with
 * `auth.confirmEmailCode` and continues to consent or Today. On another device the server answers `password_required`
 * and the form adds the password field. A turned-down code shows on the field; "Send a new code" replaces the old one.
 * Focuses the code field when it appears (the password field when that is what's missing).
 */
export function EmailCodeForm({ email: knownEmail, userId = null, code: linkCode = null, initialError }: EmailCodeFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const initial = initialError === undefined ? null : asApiError(initialError);
  const initialMessage = initial ? problemToMessage(initial, 'email-code').message : null;
  const email = useField(emailRule);
  const code = useField(codeRule, passwordRequired(initial) ? (linkCode ?? '') : '');
  const password = useField(required);
  const [needsPassword, setNeedsPassword] = useState(passwordRequired(initial));
  const [wrong, setWrong] = useState(initial?.status === 401 && !passwordRequired(initial) ? initialMessage : null);
  const [problem, setProblem] = useState(initial?.status === 401 ? null : initialMessage);
  const [resendProblem, setResendProblem] = useState<string | null>(null);
  const askEmail = !knownEmail && !(userId && needsPassword);

  useEffect(() => (needsPassword ? passwordInput : input).current?.focus(), []);

  const address = () => knownEmail ?? email.value.trim();

  function account(): { email: string } | { userId: string } {
    if (knownEmail) return { email: knownEmail };
    if (userId && (!email.value.trim() || email.invalid)) return { userId };
    return { email: email.value.trim() };
  }

  const confirm = useMutation({
    mutationFn: (value: string) => {
      const body: EmailCode = { ...account(), code: value, signupKey: peekSignupKey() ?? undefined };
      if (needsPassword) body.password = password.value;
      return auth.confirmEmailCode(body);
    },
    onSuccess: (me) => continueAfterCode(navigate, me),
    onError: (error) => {
      const apiError = asApiError(error);
      const message = problemToMessage(apiError, 'email-code').message;
      if (passwordRequired(apiError)) {
        flushSync(() => setNeedsPassword(true));
        passwordInput.current?.focus();
      } else if (apiError.status === 401) {
        flushSync(() => setWrong(message));
        focusFirstInvalid(form.current);
      } else {
        setProblem(message);
      }
    },
  });

  const resend = useMutation({
    mutationFn: (to: string) => api.resendConfirmationEmail(to, peekSignupKey(to)),
    onSuccess: () => input.current?.focus(),
    onError: (error) => setResendProblem(problemToMessage(asApiError(error)).message),
  });

  function send(value: string): void {
    if (confirm.isPending) return;
    setWrong(null);
    setProblem(null);
    confirm.mutate(value);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (confirm.isPending) return;
    const fields = [...(askEmail && !userId ? [email] : []), code, ...(needsPassword ? [password] : [])];
    if (!validateAll(form.current, fields)) return;
    send(code.value);
  }

  function changeCode(event: ChangeEvent<HTMLInputElement>): void {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    event.target.value = digits;
    code.input.onChange(event);
    setWrong(null);
    const accountKnown = knownEmail || userId || !email.invalid;
    if (digits.length === 6 && accountKnown && (!needsPassword || password.value)) send(digits);
  }

  function resendCode(): void {
    if (resend.isPending) return;
    if (!knownEmail && !validateAll(form.current, [email])) return;
    setResendProblem(null);
    resend.mutate(address());
  }

  return (
    <>
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {askEmail && (
          <FormField label={t('auth.email')} optional={!!userId} error={email.error}>
            {(field) => (
              <Input
                {...field}
                {...email.input}
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
              />
            )}
          </FormField>
        )}
        <FormField label={t('auth.code.label')} error={code.error ?? wrong}>
          {(field) => (
            <Input
              {...field}
              {...code.input}
              onChange={changeCode}
              ref={input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              className="max-w-[12rem] font-mono tracking-widest"
            />
          )}
        </FormField>
        {needsPassword && (
          <FormField label={t('auth.password')} hint={t('errors.code.passwordRequired')} error={password.error}>
            {(field) => (
              <PasswordInput {...field} {...password.input} ref={passwordInput} autoComplete="current-password" />
            )}
          </FormField>
        )}
        {problem && <Notice tone="notice">{problem}</Notice>}
        <BusyButton type="submit" block busy={confirm.isPending} busyLabel={t('auth.signingYouIn')}>
          {t('auth.code.submit')}
        </BusyButton>
      </form>
      {(knownEmail || askEmail) && (
        <>
          {resend.isSuccess && (
            <Notice tone="success">{t('auth.code.resent')}</Notice>
          )}
          {resendProblem && <Notice tone="notice">{resendProblem}</Notice>}
          <p className="text-muted-foreground">{t('auth.code.nothing')}</p>
          <BusyButton
            type="button"
            variant="secondary"
            block
            busy={resend.isPending}
            busyLabel={t('auth.sending')}
            onClick={resendCode}
          >
            {t('auth.code.resend')}
          </BusyButton>
        </>
      )}
    </>
  );
}
