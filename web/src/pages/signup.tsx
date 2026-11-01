import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { EnvelopeSpark } from '@/components/auth/illustrations';
import {
  email as emailRule,
  minLength,
  useField,
  useFocusHeadingOnChange,
  validateAll,
} from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { Credentials } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

const passwordHint = "At least 10 characters. A short phrase you'll remember works well.";

/** `/signup`: email and password, then the "Check your inbox" view with a resend action. */
export default function SignupPage() {
  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const password = useField(minLength(10));
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  useFocusHeadingOnChange(sentTo);

  const register = useMutation({
    mutationFn: (body: Credentials) => api.register(body),
    onSuccess: (_, body) => setSentTo(body.email),
    onError: (error) => setProblem(problemToMessage(asApiError(error), 'register')),
  });

  const resend = useMutation({
    mutationFn: (address: string) => api.resendConfirmationEmail(address),
    onError: (error) => setProblem(problemToMessage(asApiError(error))),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (register.isPending) return;
    if (!validateAll(form.current, [email, password])) return;
    setProblem(null);
    register.mutate({ email: email.value.trim(), password: password.value });
  }

  function resendLink(address: string) {
    if (resend.isPending) return;
    setProblem(null);
    resend.mutate(address);
  }

  if (sentTo !== null) {
    return (
      <>
        <PageHeader
          title="Check your inbox"
          lede={`We sent an email to ${sentTo}. Open the link inside to finish setting up.`}
        />
        <EnvelopeSpark className="self-center" />
        {resend.isSuccess && <Notice tone="success">Sent again. It can take a minute or two to arrive.</Notice>}
        {problem && <Notice tone="notice">{problem.message}</Notice>}
        <p className="text-muted-foreground">Nothing there? Check your spam folder, or we can send it again.</p>
        <div className="flex flex-col gap-3">
          <BusyButton
            type="button"
            variant="secondary"
            block
            busy={resend.isPending}
            busyLabel="Sending…"
            onClick={() => resendLink(sentTo)}
          >
            Send it again
          </BusyButton>
          <Button asChild variant="ghost" block>
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Create your account" lede="A calm place for your habits. It takes a minute." />
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
          {(field) => <Input {...field} {...password.input} type="password" autoComplete="new-password" />}
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
      <p className="text-center text-muted-foreground">
        Already have an account? <TapLink to="/login">Sign in</TapLink>
      </p>
    </>
  );
}
