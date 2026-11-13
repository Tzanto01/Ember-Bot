import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { DiscordButton } from '@/components/auth/discord-button';
import { EmailCodeForm } from '@/components/auth/email-code-form';
import { EnvelopeSpark } from '@/components/auth/illustrations';
import { newSignupKey, rememberSignupEmail } from '@/components/auth/signup-email';
import { email as emailRule, minLength, useField, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { NoAccountLink, UpgradingNotice } from '@/components/local/upgrade-choice';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { pitch } from '@/content/pitch';
import type { Credentials } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

/** `/signup`: email and password, then the "Check your inbox" view with the emailed code and a resend action. */
export default function SignupPage() {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const password = useField(minLength(10));
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: ({ body, signupKey }: { body: Credentials; signupKey: string }) => api.register(body, signupKey),
    onSuccess: (_, { body, signupKey }) => {
      rememberSignupEmail(body.email, signupKey);
      setSentTo(body.email);
    },
    onError: (error) => setProblem(problemToMessage(asApiError(error), 'register')),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (register.isPending) return;
    if (!validateAll(form.current, [email, password])) return;
    setProblem(null);
    register.mutate({ body: { email: email.value.trim(), password: password.value }, signupKey: newSignupKey() });
  }

  if (sentTo !== null) {
    return (
      <>
        <PageHeader title={t('signup.sent.title')} lede={t('signup.sent.lede', { email: sentTo })} />
        <EnvelopeSpark className="self-center" />
        <EmailCodeForm email={sentTo} />
        <Button asChild variant="ghost" block>
          <Link to="/login">{t('auth.backToSignIn')}</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('signup.title')} lede={t('signup.lede', { description: pitch.description })} />
      <UpgradingNotice />
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FormField label={t('auth.email')} error={email.error ?? problem?.fields['email'] ?? null}>
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
        <FormField label={t('auth.password')} hint={t('auth.passwordHint')} error={password.error ?? problem?.fields['password'] ?? null}>
          {(field) => <PasswordInput {...field} {...password.input} autoComplete="new-password" />}
        </FormField>

        {problem && <Notice tone="notice">{problem.message}</Notice>}

        <p className="text-muted-foreground">
          <Trans
            i18nKey="signup.accept"
            components={{
              terms: <Link to="/legal/terms" className="text-primary underline underline-offset-4" />,
              privacy: <Link to="/legal/privacy" className="text-primary underline underline-offset-4" />,
            }}
          />
        </p>

        <BusyButton type="submit" block busy={register.isPending} busyLabel={t('signup.creating')}>
          {t('signup.submit')}
        </BusyButton>
        <p className="text-center text-[14px] text-muted-foreground">{t('auth.age')}</p>
      </form>
      <DiscordButton>{t('auth.discordContinue')}</DiscordButton>
      <p className="text-center text-muted-foreground">
        {t('signup.haveAccount')} <TapLink to="/login">{t('signup.signIn')}</TapLink>
      </p>
      <NoAccountLink />
    </>
  );
}
