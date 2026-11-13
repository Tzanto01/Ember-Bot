import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { MomentDoor } from '@/components/moment/moment-door';
import { DiscordButton } from '@/components/auth/discord-button';
import { peekSignupKey } from '@/components/auth/signup-email';
import {
  email as emailRule,
  required,
  useField,
  useFocusHeadingOnChange,
  validateAll,
} from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { NoAccountLink, UpgradingNotice } from '@/components/local/upgrade-choice';
import { PageHeader } from '@/components/page-header';
import { CodeInput, cleanCode, codeRule, recoveryRule, wrongCodeText } from '@/components/settings/two-factor-code';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { env } from '@/lib/env';
import { type DiscordCode, listenForDiscord, startDiscordSignIn } from '@/lib/native/discord';
import { queryString } from '@/lib/navigation';
import { asApiError, type FriendlyProblem, problemToMessage, requiresTwoFactor } from '@/lib/problem';
import { safeReturnUrl } from '@/lib/return-url';
import { api, auth } from '@/lib/services';

interface Credentials {
  email: string;
  password: string;
  staySignedIn: boolean;
}

type SecondFactor = { code: string } | { recoveryCode: string };

/**
 * The second sign-in step: an authenticator code, or a recovery code instead. A 400 or 401 answer is a wrong code
 * and shows as a field error.
 */
function TwoFactorStep({
  onSubmit,
  onBack,
  backLabel,
}: {
  onSubmit: (secret: SecondFactor) => Promise<unknown>;
  onBack: () => void;
  backLabel: string;
}) {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const code = useField(codeRule);
  const recovery = useField(recoveryRule);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRecovery ? recovery : code;

  useEffect(() => input.current?.focus(), [useRecovery]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, [field])) return;
    setBusy(true);
    setWrong(false);
    setProblem(null);
    try {
      await onSubmit(useRecovery ? { recoveryCode: recovery.value.trim() } : { code: cleanCode(code.value) });
      return;
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 400 || apiError.status === 401) {
        flushSync(() => setWrong(true));
        focusFirstInvalid(form.current);
      } else if (!apiError.handled) {
        setProblem(problemToMessage(apiError, 'login').message);
      }
    }
    setBusy(false);
  }

  function toggle(): void {
    setUseRecovery((value) => !value);
    setWrong(false);
    setProblem(null);
  }

  const error =
    field.error ??
    (wrong ? (useRecovery ? t('login.twoFactor.recoveryWrong') : wrongCodeText()) : null);
  return (
    <>
      <PageHeader
        title={t('login.twoFactor.title')}
        lede={useRecovery ? t('login.twoFactor.ledeRecovery') : t('login.twoFactor.lede')}
      />
      <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {useRecovery ? (
          <FormField key="recovery" label={t('login.twoFactor.recoveryLabel')} error={error}>
            {(control) => (
              <Input
                {...control}
                {...recovery.input}
                ref={input}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </FormField>
        ) : (
          <FormField key="code" label={t('login.twoFactor.codeLabel')} error={error}>
            {(control) => <CodeInput ref={input} field={code} control={control} />}
          </FormField>
        )}
        <div>
          <Button type="button" variant="link" className="px-0" onClick={toggle}>
            {useRecovery ? t('login.twoFactor.useApp') : t('login.twoFactor.useRecovery')}
          </Button>
        </div>
        {problem && (
          <Notice tone="notice">
            <p>{problem}</p>
          </Notice>
        )}
        <BusyButton type="submit" block busy={busy} busyLabel={t('login.signingIn')}>
          {t('login.submit')}
        </BusyButton>
        <Button type="button" variant="secondary" block onClick={onBack}>
          {backLabel}
        </Button>
      </form>
    </>
  );
}

/**
 * `/login`: email and password sign-in, and Discord sign-in (native: in the system browser, returning to the app with a
 * one-time code). After a `RequiresTwoFactor` answer it asks for the second factor on the same page, keeping the email
 * and password (or the native Discord code) in memory only for that step; `/login?step=2fa` is that step for a web
 * Discord sign-in.
 */
export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnUrl = safeReturnUrl(params.get('returnUrl'));
  const reason = params.get('reason');
  const discordFailed = params.get('discord') === 'error';
  const discordStep = params.get('step') === '2fa';
  const { t } = useTranslation();

  const form = useRef<HTMLFormElement>(null);
  const email = useField(emailRule);
  const password = useField(required);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);
  const [pending, setPending] = useState<Credentials | null>(null);
  const [offlineForm, setOfflineForm] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [discordCode, setDiscordCode] = useState<DiscordCode | null>(null);
  const [discordError, setDiscordError] = useState(false);
  const onDiscord = useRef<(result: DiscordCode | 'error') => void>(() => undefined);
  useFocusHeadingOnChange(offlineForm);

  useEffect(() => {
    onDiscord.current = (result) => {
      setProblem(null);
      setDiscordError(false);
      if (result === 'error') {
        setDiscordError(true);
        return;
      }
      auth.loginWithDiscord(result).then(signedIn, (error: unknown) => {
        if (requiresTwoFactor(error)) setDiscordCode(result);
        else setDiscordError(true);
      });
    };
  });

  useEffect(() => {
    if (!env.native) return;
    let stop: (() => void) | null = null;
    let gone = false;
    void listenForDiscord((result) => onDiscord.current(result)).then((remove) => {
      if (gone) remove();
      else stop = remove;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  async function retry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    await navigate(returnUrl);
    setRetrying(false);
  }

  function signedIn(): void {
    void navigate(auth.needsConsent() ? `/consent?${queryString({ returnUrl })}` : returnUrl);
  }

  const login = useMutation({
    mutationFn: (body: Credentials) => auth.login(body.email, body.password, body.staySignedIn),
    onSuccess: signedIn,
    onError: (error, body) => {
      if (requiresTwoFactor(error)) setPending(body);
      else setProblem(problemToMessage(asApiError(error), 'login'));
    },
  });

  const resend = useMutation({
    mutationFn: (address: string) => api.resendConfirmationEmail(address, peekSignupKey(address)),
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

  async function secondFactor(secret: SecondFactor): Promise<void> {
    if (pending) {
      await auth.login(pending.email, pending.password, pending.staySignedIn, secret);
    } else if (discordCode) {
      await auth.loginWithDiscord(discordCode, secret);
    } else {
      await auth.completeDiscordTwoFactor(secret);
    }
    signedIn();
  }

  if (pending || discordCode || discordStep) {
    return (
      <TwoFactorStep
        onSubmit={secondFactor}
        onBack={() => {
          if (pending) setPending(null);
          else if (discordCode) setDiscordCode(null);
          else void navigate({ search: '' }, { replace: true });
        }}
        backLabel={pending || discordCode ? t('login.back') : t('login.backToSignIn')}
      />
    );
  }

  if (reason === 'offline' && !offlineForm) {
    return (
      <>
        <PageHeader
          title={t('login.offline.title')}
          lede={t('login.offline.lede')}
        />
        <div className="flex flex-col gap-3">
          <BusyButton type="button" block busy={retrying} busyLabel={t('login.offline.retrying')} onClick={() => void retry()}>
            {t('login.offline.retry')}
          </BusyButton>
          <Button type="button" variant="ghost" block onClick={() => setOfflineForm(true)}>
            {t('login.offline.signIn')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('login.title')} lede={t('login.lede')} />
      <UpgradingNotice />
      {(discordFailed || discordError) && <Notice tone="notice">{t('login.discordFailed')}</Notice>}
      {reason === 'session' && <Notice>{t('login.sessionEnded')}</Notice>}
      {reason === 'deleted' && (
        <Notice>{t('login.deleted')}</Notice>
      )}

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
        <FormField label={t('auth.password')} error={password.error}>
          {(field) => <PasswordInput {...field} {...password.input} autoComplete="current-password" />}
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-h-[44px] items-center gap-3">
            <Checkbox
              id="stay-signed-in"
              checked={staySignedIn}
              onCheckedChange={(checked) => setStaySignedIn(checked === true)}
            />
            <Label htmlFor="stay-signed-in" className="font-normal whitespace-nowrap">
              {t('login.staySignedIn')}
            </Label>
          </div>
          <TapLink to="/forgot-password" className="whitespace-nowrap">
            {t('login.forgot')}
          </TapLink>
        </div>

        {problem && (
          <Notice tone="notice">
            <p>{problem.message}</p>
            {problem.offerResend &&
              (resend.isSuccess ? (
                <p>{t('auth.resendSent')}</p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  aria-disabled={resend.isPending || undefined}
                  onClick={() => resend.mutate(email.value.trim())}
                >
                  {t('login.resend')}
                </Button>
              ))}
            {problem.offerResend && (
              <TapLink to="/confirm-email" state={{ email: email.value.trim() }}>
                {t('login.enterCode')}
              </TapLink>
            )}
          </Notice>
        )}

        <BusyButton type="submit" block busy={login.isPending} busyLabel={t('login.signingIn')}>
          {t('login.submit')}
        </BusyButton>
      </form>

      <DiscordButton returnUrl={returnUrl} onNative={() => void startDiscordSignIn()}>
        {env.native ? t('auth.discordContinue') : t('login.discord')}
      </DiscordButton>
      <p className="text-center text-muted-foreground">
        {t('login.newHere')} <TapLink to="/signup">{t('login.createAccount')}</TapLink>
      </p>
      <NoAccountLink />
      {!env.native && (
        <p className="text-center">
          <TapLink to="/download">{t('login.getApp')}</TapLink>
        </p>
      )}
      <p className="text-center">
        <TapLink to="/feedback">{t('login.feedback')}</TapLink>
      </p>
      <p className="flex flex-wrap justify-center gap-x-6 text-center">
        <MomentDoor variant="quiet" />
        <TapLink to="/help">{t('legalLinks.help')}</TapLink>
      </p>
    </>
  );
}
