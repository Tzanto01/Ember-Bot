import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type NavigateFunction, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { takeSignupEmail } from '@/components/auth/signup-email';
import { email as emailRule, useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { Me } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';

const codeRule: Validator = (value) => {
  if (!value) return 'Enter the 6-digit code from the email.';
  return /^\d{6}$/.test(value) ? null : 'The code is 6 digits.';
};

/** After a code sign-in: forgets the kept sign-up address and goes to consent or Today (sign-in when `me` didn't load). */
export function continueAfterCode(navigate: NavigateFunction, me: Me | null): void {
  takeSignupEmail();
  if (!me) void navigate('/login');
  else void navigate(auth.needsConsent() ? '/consent?returnUrl=%2Ftoday' : '/today');
}

export interface EmailCodeFormProps {
  /** The address the code went to; when null, the form asks for it. */
  email: string | null;
  /** A failed confirmation that happened before the form showed, for example from the email link. */
  initialError?: unknown;
}

/**
 * The emailed 6-digit code: submits on the sixth digit (or the button), signs in with `auth.confirmEmailCode` and
 * continues to consent or Today. A turned-down code shows on the field; "Send a new code" replaces the old one.
 * Focuses the code field when it appears.
 */
export function EmailCodeForm({ email: knownEmail, initialError }: EmailCodeFormProps) {
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const email = useField(emailRule);
  const code = useField(codeRule);
  const initial = initialError === undefined ? null : asApiError(initialError);
  const initialMessage = initial ? problemToMessage(initial, 'email-code').message : null;
  const [wrong, setWrong] = useState(initial?.status === 401 ? initialMessage : null);
  const [problem, setProblem] = useState(initial?.status === 401 ? null : initialMessage);
  const [resendProblem, setResendProblem] = useState<string | null>(null);

  useEffect(() => input.current?.focus(), []);

  const address = () => knownEmail ?? email.value.trim();

  const confirm = useMutation({
    mutationFn: (value: string) => auth.confirmEmailCode({ email: address(), code: value }),
    onSuccess: (me) => continueAfterCode(navigate, me),
    onError: (error) => {
      const apiError = asApiError(error);
      const message = problemToMessage(apiError, 'email-code').message;
      if (apiError.status === 401) {
        flushSync(() => setWrong(message));
        focusFirstInvalid(form.current);
      } else {
        setProblem(message);
      }
    },
  });

  const resend = useMutation({
    mutationFn: (to: string) => api.resendConfirmationEmail(to),
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
    if (!validateAll(form.current, knownEmail ? [code] : [email, code])) return;
    send(code.value);
  }

  function changeCode(event: ChangeEvent<HTMLInputElement>): void {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    event.target.value = digits;
    code.input.onChange(event);
    setWrong(null);
    if (digits.length === 6 && (knownEmail || !email.invalid)) send(digits);
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
        {!knownEmail && (
          <FormField label="Email" error={email.error}>
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
        <FormField label="6-digit code" error={code.error ?? wrong}>
          {(field) => (
            <Input
              {...field}
              {...code.input}
              onChange={changeCode}
              ref={input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              spellCheck={false}
              className="max-w-[12rem] font-mono tracking-widest"
            />
          )}
        </FormField>
        {problem && <Notice tone="notice">{problem}</Notice>}
        <BusyButton type="submit" block busy={confirm.isPending} busyLabel="Signing you in…">
          Finish signing up
        </BusyButton>
      </form>
      {resend.isSuccess && <Notice tone="success">A new code is on its way. It can take a minute or two to arrive.</Notice>}
      {resendProblem && <Notice tone="notice">{resendProblem}</Notice>}
      <p className="text-muted-foreground">Nothing there? Check your spam folder, or we can send a new code.</p>
      <BusyButton
        type="button"
        variant="secondary"
        block
        busy={resend.isPending}
        busyLabel="Sending…"
        onClick={resendCode}
      >
        Send a new code
      </BusyButton>
    </>
  );
}
