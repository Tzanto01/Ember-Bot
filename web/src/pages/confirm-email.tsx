import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { takeSignupEmail } from '@/components/auth/signup-email';
import {
  email as emailRule,
  required,
  useField,
  useFocusHeadingOnChange,
  validateAll,
} from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';

type ConfirmState = 'password' | 'confirmed' | 'incomplete';

/** "Email for a new link" form; replaced by a success notice once sent. */
function ResendForm({ primary = false }: { primary?: boolean }) {
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
        variant={primary ? 'default' : 'secondary'}
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
 * `/confirm-email?userId=…&code=…`: confirms with the password chosen at sign-up. The link values are kept in memory
 * and removed from the address bar on load. When this device signed up with an address, it then signs in with it and
 * the same password and continues to consent; otherwise, or when that sign-in fails, it shows "You're confirmed".
 */
export default function ConfirmEmailPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [link] = useState(() => ({ userId: params.get('userId'), code: params.get('code') }));
  const [state, setState] = useState<ConfirmState>(link.userId && link.code ? 'password' : 'incomplete');
  const [problem, setProblem] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const password = useField(required);
  useFocusHeadingOnChange(state);

  useEffect(() => {
    if (!params.has('code') && !params.has('userId')) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('code');
        next.delete('userId');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

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

  if (state === 'incomplete') {
    return (
      <>
        <PageHeader title="Let's get you a fresh link" />
        <Notice>This link looks incomplete. Open it again from the email, or ask for a new one here.</Notice>
        <ResendForm primary />
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
