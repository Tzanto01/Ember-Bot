import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { email as emailRule, required, useField, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Separator } from '@/components/ui/separator';
import { env } from '@/lib/env';
import { openOnWeb } from '@/lib/native/browser';
import { queryString } from '@/lib/navigation';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { safeReturnUrl } from '@/lib/return-url';
import { api, auth } from '@/lib/services';

interface Credentials {
  email: string;
  password: string;
  staySignedIn: boolean;
}

/** `/login`: email and password sign-in, Discord sign-in (web) or the "Open Ember on the web" hand-off (native). */
export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnUrl = safeReturnUrl(params.get('returnUrl'));
  const reason = params.get('reason');
  const discordFailed = params.get('discord') === 'error';

  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const password = useField(required);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);

  const login = useMutation({
    mutationFn: (body: Credentials) => auth.login(body.email, body.password, body.staySignedIn),
    onSuccess: () => {
      void navigate(auth.needsConsent() ? `/consent?${queryString({ returnUrl })}` : returnUrl);
    },
    onError: (error) => setProblem(problemToMessage(asApiError(error), 'login')),
  });

  const resend = useMutation({
    mutationFn: (address: string) => api.resendConfirmationEmail(address),
    onError: (error) => setProblem(problemToMessage(asApiError(error))),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;
    if (!validateAll(form.current, [email, password])) return;
    setProblem(null);
    resend.reset();
    login.mutate({ email: email.value.trim(), password: password.value, staySignedIn });
  }

  return (
    <>
      <PageHeader title="Welcome back" lede="Sign in to check in on your habits." />
      {discordFailed && <Notice tone="notice">Discord sign-in didn't finish. You can try again.</Notice>}
      {reason === 'session' && <Notice>Your session ended. Sign in again to pick up where you left off.</Notice>}
      {reason === 'offline' && (
        <Notice tone="notice">Ember can't be reached right now. Check your connection, then try again.</Notice>
      )}
      {reason === 'deleted' && (
        <Notice>Your account and everything in it are deleted. Thank you for spending time with Ember.</Notice>
      )}

      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FormField label="Email" error={email.error ?? problem?.fields['email'] ?? null}>
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
        <FormField label="Password" error={password.error}>
          {(field) => <PasswordInput {...field} {...password.input} autoComplete="current-password" />}
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-h-[44px] items-center gap-3">
            <Checkbox
              id="stay-signed-in"
              checked={staySignedIn}
              onCheckedChange={(checked) => setStaySignedIn(checked === true)}
            />
            <Label htmlFor="stay-signed-in" className="font-normal">
              Stay signed in
            </Label>
          </div>
          <TapLink to="/forgot-password">Forgot password?</TapLink>
        </div>

        {problem && (
          <Notice tone="notice">
            <p>{problem.message}</p>
            {problem.offerResend &&
              (resend.isSuccess ? (
                <p>If that address still needs confirming, a fresh link is on its way.</p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  aria-disabled={resend.isPending || undefined}
                  onClick={() => resend.mutate(email.value.trim())}
                >
                  Send the link again
                </Button>
              ))}
          </Notice>
        )}

        <BusyButton type="submit" block busy={login.isPending} busyLabel="Signing in…">
          Sign in
        </BusyButton>
      </form>

      {env.native ? (
        <>
          <p className="text-muted-foreground">
            Started with the Ember bot on Discord? Discord sign-in works on the web. Create an email login there, then
            link Discord in Settings: your habits come along.
          </p>
          <Button type="button" variant="secondary" block onClick={() => void openOnWeb('/signup')}>
            Open Ember on the web
          </Button>
        </>
      ) : (
        <>
          <Separator>or</Separator>
          <Button asChild variant="secondary" block>
            <a href={api.discordLoginUrl(returnUrl)}>Sign in with Discord</a>
          </Button>
        </>
      )}
      <p className="text-center text-muted-foreground">
        New to Ember? <TapLink to="/signup">Create an account</TapLink>
      </p>
    </>
  );
}
