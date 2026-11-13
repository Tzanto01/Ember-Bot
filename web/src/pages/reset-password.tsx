import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { minLength, useField, useFocusHeadingOnChange, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { ResetPasswordRequest } from '@/lib/models';
import { type ApiError, asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

function linkExpired(error: ApiError): boolean {
  return error.status === 401 || !!error.problem?.errors?.['InvalidToken'];
}

/** `/reset-password?email=…&code=…`: chooses a new password. The code is kept in memory and removed from the address bar on load. */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [link] = useState(() => ({ email: params.get('email'), code: params.get('code') }));
  const form = useRef<HTMLFormElement>(null);
  const newPassword = useField(minLength(10));
  const [problem, setProblem] = useState<{ friendly: FriendlyProblem; expired: boolean } | null>(null);

  useEffect(() => {
    if (!params.has('code')) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('code');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  const reset = useMutation({
    mutationFn: (body: ResetPasswordRequest) => api.resetPassword(body),
    onError: (error) => {
      const apiError = asApiError(error);
      setProblem({ friendly: problemToMessage(apiError, 'reset-password'), expired: linkExpired(apiError) });
    },
  });
  useFocusHeadingOnChange(reset.isSuccess);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reset.isPending || !link.email || !link.code) return;
    if (!validateAll(form.current, [newPassword])) return;
    setProblem(null);
    reset.mutate({ email: link.email, resetCode: link.code, newPassword: newPassword.value });
  }

  if (reset.isSuccess) {
    return (
      <>
        <PageHeader title={t('reset.done.title')} lede={t('reset.done.lede')} />
        <Button asChild block>
          <Link to="/login">{t('auth.signIn')}</Link>
        </Button>
      </>
    );
  }

  if (!link.email || !link.code) {
    return (
      <>
        <PageHeader title={t('reset.incomplete.title')} />
        <Notice>{t('reset.incomplete.body')}</Notice>
        <Button asChild block>
          <Link to="/forgot-password">{t('auth.newLink')}</Link>
        </Button>
        <Button asChild variant="ghost" block>
          <Link to="/login">{t('auth.backToSignIn')}</Link>
        </Button>
      </>
    );
  }

  const fields = problem?.friendly.fields;
  return (
    <>
      <PageHeader title={t('reset.title')} lede={t('reset.lede', { email: link.email })} />
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <input
          className="sr-only"
          type="email"
          name="username"
          autoComplete="username"
          value={link.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <FormField
          label={t('reset.newPassword')}
          hint={t('auth.passwordHint')}
          error={newPassword.error ?? fields?.['password'] ?? fields?.['newPassword'] ?? null}
        >
          {(field) => <PasswordInput {...field} {...newPassword.input} autoComplete="new-password" />}
        </FormField>
        {problem && (
          <Notice tone="notice">
            <p>{problem.friendly.message}</p>
            {problem.expired && (
              <Link
                to="/forgot-password"
                className="inline-flex min-h-[44px] items-center font-medium underline underline-offset-4"
              >
                {t('auth.newLink')}
              </Link>
            )}
          </Notice>
        )}
        <BusyButton type="submit" block busy={reset.isPending} busyLabel={t('auth.saving')}>
          {t('reset.submit')}
        </BusyButton>
      </form>
    </>
  );
}
