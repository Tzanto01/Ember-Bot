import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { DiscordButton } from '@/components/auth/discord-button';
import { EmailCodeForm } from '@/components/auth/email-code-form';
import { EnvelopeSpark } from '@/components/auth/illustrations';
import { rememberSignupEmail } from '@/components/auth/signup-email';
import { email as emailRule, minLength, useField, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { NoAccountLink, UpgradingNotice } from '@/components/local/upgrade-choice';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { Credentials } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

const passwordHint = "At least 10 characters. A short phrase you'll remember works well.";

/** `/signup`: email and password, then the "Check your inbox" view with the emailed code and a resend action. */
export default function SignupPage() {
  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const password = useField(minLength(10));
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: (body: Credentials) => api.register(body),
    onSuccess: (_, body) => {
      rememberSignupEmail(body.email);
      setSentTo(body.email);
    },
    onError: (error) => setProblem(problemToMessage(asApiError(error), 'register')),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (register.isPending) return;
    if (!validateAll(form.current, [email, password])) return;
    setProblem(null);
    register.mutate({ email: email.value.trim(), password: password.value });
  }

  if (sentTo !== null) {
    return (
      <>
        <PageHeader title="Check your inbox" lede={`We sent a 6-digit code to ${sentTo}. Enter it here to finish.`} />
        <EnvelopeSpark className="self-center" />
        <EmailCodeForm email={sentTo} />
        <Button asChild variant="ghost" block>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Create your account" lede="A calm place for your habits. It takes a minute." />
      <UpgradingNotice />
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
        <FormField label="Password" hint={passwordHint} error={password.error ?? problem?.fields['password'] ?? null}>
          {(field) => <PasswordInput {...field} {...password.input} autoComplete="new-password" />}
        </FormField>

        {problem && <Notice tone="notice">{problem.message}</Notice>}

        <p className="text-muted-foreground">
          Creating an account means you accept the{' '}
          <Link to="/legal/terms" className="text-primary underline underline-offset-4">
            terms
          </Link>
          . The{' '}
          <Link to="/legal/privacy" className="text-primary underline underline-offset-4">
            privacy policy
          </Link>{' '}
          explains what Ember stores and why.
        </p>

        <BusyButton type="submit" block busy={register.isPending} busyLabel="Creating your account…">
          Create account
        </BusyButton>
      </form>
      <DiscordButton>Continue with Discord</DiscordButton>
      <p className="text-center text-muted-foreground">
        Already have an account? <TapLink to="/login">Sign in</TapLink>
      </p>
      <NoAccountLink />
    </>
  );
}
