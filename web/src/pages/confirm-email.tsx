import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { continueAfterCode, EmailCodeForm } from '@/components/auth/email-code-form';
import { peekSignupEmail, takeSignupEmail } from '@/components/auth/signup-email';
import {
  email as emailRule,
  required,
  useField,
  useFocusHeadingOnChange,
  validateAll,
} from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';

type ConfirmState = 'checking' | 'code' | 'password' | 'confirmed';

/** "Email for a new link" form; replaced by a success notice once sent. */
function ResendForm() {
  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const [problem, setProblem] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: (address: string) => api.resendConfirmationEmail(address),
    onError: (error) => setProblem(problemToMessage(asApiError(error)).message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resend.isPending) return;
    if (!validateAll(form.current, [email])) return;
    setProblem(null);
    resend.mutate(email.value.trim());
  }

  if (resend.isSuccess) {
    return <Notice tone="success">If that address still needs confirming, a fresh link is on its way.</Notice>;
  }
  return (
    <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <FormField label="Email for a new link" error={email.error ?? problem}>
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
      <BusyButton
        type="submit"
        variant="secondary"
        block
        busy={resend.isPending}
        busyLabel="Sending…"
      >
        Send me a new link
      </BusyButton>
    </form>
  );
}

/**
 * `/confirm-email?user=…&code=…`: confirms with the emailed code and signs in right away, then continues to consent or
 * Today; when that fails it shows the code form with the error. Without link values it shows the code form, with the
 * address this device signed up with filled in.
 *
 * `/confirm-email?userId=…&code=…` (links from before the code): confirms with the password chosen at sign-up. When this
 * device signed up with an address, it then signs in with it and the same password and continues to consent;
 * otherwise, or when that sign-in fails, it shows "You're confirmed".
 *
 * The link values are kept in memory and removed from the address bar on load.
 */
export default function ConfirmEmailPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [link] = useState(() => ({ user: params.get('user'), userId: params.get('userId'), code: params.get('code') }));
  const [state, setState] = useState<ConfirmState>(
    link.user && link.code ? 'checking' : link.userId && link.code ? 'password' : 'code',
  );
  const [codeError, setCodeError] = useState<unknown>(undefined);
  const [keptEmail] = useState(peekSignupEmail);
  const [problem, setProblem] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  const password = useField(required);
  useFocusHeadingOnChange(state === 'code' ? 'checking' : state);

  useEffect(() => {
    if (!params.has('code') && !params.has('userId') && !params.has('user')) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('code');
        next.delete('userId');
        next.delete('user');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  useEffect(() => {
    if (started.current || !link.user || !link.code) return;
    started.current = true;
    auth.confirmEmailCode({ userId: link.user, code: link.code }).then(
      (me) => continueAfterCode(navigate, me),
      (error: unknown) => {
        setCodeError(error);
        setState('code');
      },
    );
  }, [link, navigate]);

  const confirm = useMutation({
    mutationFn: async (body: { userId: string; code: string; password: string }) => {
      await api.confirmEmail(body.userId, body.code, body.password);
      const email = takeSignupEmail();
      if (!email) return false;
      return auth.login(email, body.password, false).then(
        (me) => !!me,
        () => false,
      );
    },
    onSuccess: (signedIn) => {
      if (!signedIn) setState('confirmed');
      else void navigate(auth.needsConsent() ? '/consent?returnUrl=%2Ftoday' : '/today');
    },
    onError: (error) => setProblem(problemToMessage(asApiError(error), 'confirm-email').message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm.isPending || !link.userId || !link.code) return;
    if (!validateAll(form.current, [password])) return;
    setProblem(null);
    confirm.mutate({ userId: link.userId, code: link.code, password: password.value });
  }

  if (state === 'confirmed') {
    return (
      <>
        <PageHeader title="You're confirmed" lede="Welcome to Ember. Sign in whenever you're ready." />
        <Button asChild block>
          <Link to="/login">Sign in</Link>
        </Button>
      </>
    );
  }

  if (state === 'checking') {
    return (
      <>
        <PageHeader title="Confirming your email" />
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          Signing you in…
        </p>
      </>
    );
  }

  if (state === 'code') {
    return (
      <>
        <PageHeader title="Enter your code" lede="Type the 6-digit code from the email we sent you." />
        <EmailCodeForm email={keptEmail} initialError={codeError} />
        <Button asChild variant="ghost" block>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Confirm your email" lede="Enter the password you chose when you signed up." />
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
          <Link to="/forgot-password" className="inline-flex min-h-[44px] items-center font-medium underline underline-offset-4">
            Reset your password
          </Link>
        </Notice>
      )}
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FormField label="Password" error={password.error}>
          {(field) => <PasswordInput {...field} {...password.input} autoComplete="current-password" />}
        </FormField>
        <BusyButton type="submit" block busy={confirm.isPending} busyLabel="Confirming…">
          Confirm email
        </BusyButton>
      </form>
      {problem && <ResendForm />}
    </>
  );
}
