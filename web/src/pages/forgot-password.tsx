import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <Button asChild variant="ghost" block>
      <Link to="/login">{t('auth.backToSignIn')}</Link>
    </Button>
  );
}

/** `/forgot-password`: asks for the email, then confirms a link is on its way. */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
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
          title={t('forgot.sent.title')}
          lede={t('forgot.sent.lede')}
        />
        <BackToSignIn />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('forgot.title')}
        lede={t('forgot.lede')}
      />
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FormField label={t('auth.email')} error={email.error}>
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
        <BusyButton type="submit" block busy={send.isPending} busyLabel={t('auth.sending')}>
          {t('forgot.submit')}
        </BusyButton>
      </form>
      <BackToSignIn />
    </>
  );
}
