import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { email as emailRule, useField, useFocusHeadingOnChange, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

function BackToSignIn() {
  return (
    <Button asChild variant="ghost" block>
      <Link to="/login">Back to sign in</Link>
    </Button>
  );
}

/** `/forgot-password`: asks for the email, then confirms a link is on its way. */
export default function ForgotPasswordPage() {
  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (address: string) => api.forgotPassword(address),
    onError: (error) => setProblem(problemToMessage(asApiError(error)).message),
  });
  useFocusHeadingOnChange(send.isSuccess);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (send.isPending) return;
    if (!validateAll(form.current, [email])) return;
    setProblem(null);
    send.mutate(email.value.trim());
  }

  if (send.isSuccess) {
    return (
      <>
        <PageHeader
          title="Check your inbox"
          lede="If that address has an account, a link is on its way. It can take a minute or two."
        />
        <BackToSignIn />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reset your password"
        lede="Tell us your email and we'll send you a link to choose a new one."
      />
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
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
        {problem && <Notice tone="notice">{problem}</Notice>}
        <BusyButton type="submit" block busy={send.isPending} busyLabel="Sending…">
          Send the link
        </BusyButton>
      </form>
      <BackToSignIn />
    </>
  );
}
