import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import type { Me, TwoFactorSetup, TwoFactorStatus } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';
import { QrCode } from './qr-code';
import { CopyButton, GroupedCode, RecoveryCodes } from './secret-codes';
import { CodeInput, cleanCode, codeRule, wrongCodeText } from './two-factor-code';

const statusKey = ['two-factor'] as const;
const passwordRule: Validator = (value) => (value ? null : t('settings.passwordRequired'));
const noRule: Validator = () => null;

function problemText(error: unknown): string | null {
  const apiError = asApiError(error);
  return apiError.handled ? null : problemToMessage(apiError).message;
}

/** The login password with a hidden username for password managers. */
function PasswordField({
  email,
  field,
  hint,
  error,
  inputRef,
}: {
  email: string | null;
  field: ReturnType<typeof useField>;
  hint?: string;
  error: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <>
      <input
        className="sr-only"
        type="email"
        name="username"
        autoComplete="username"
        value={email ?? ''}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <FormField label={t('settings.yourPassword')} hint={hint} error={error}>
        {(control) => (
          <PasswordInput
            {...control}
            {...field.input}
            ref={inputRef}
            autoComplete="current-password"
          />
        )}
      </FormField>
    </>
  );
}

/**
 * Asks for an authenticator code or the login password (with `withPassword`, a code and the password), then runs
 * `onSubmit`. A 400 answer is shown as a gentle field error on the field it names; anything else as a notice under the
 * form.
 */
export function ConfirmForm({
  kind,
  email,
  hint,
  withPassword = false,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  focusOnMount = true,
}: {
  focusOnMount?: boolean;
  kind: 'code' | 'password';
  email: string | null;
  hint?: string;
  withPassword?: boolean;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (value: string, password?: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const field = useField(kind === 'code' ? codeRule : passwordRule);
  const password = useField(withPassword ? passwordRule : noRule);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<'field' | 'password' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, withPassword ? [field, password] : [field])) return;
    setBusy(true);
    setRejected(null);
    setProblem(null);
    try {
      await onSubmit(
        kind === 'code' ? cleanCode(field.value) : field.value,
        withPassword ? password.value : undefined,
      );
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 400) {
        const onPassword = withPassword && apiError.problem?.errors?.['password'] !== undefined;
        flushSync(() => setRejected(onPassword ? 'password' : 'field'));
        focusFirstInvalid(form.current);
      } else {
        setProblem(problemText(error));
      }
    } finally {
      setBusy(false);
    }
  }

  const error =
    field.error ??
    (rejected === 'field' ? (kind === 'code' ? wrongCodeText() : t('settings.passwordMismatch')) : null);
  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      {kind === 'code' ? (
        <FormField label={t('twoFactor.code.label')} hint={hint} error={error}>
          {(control) => <CodeInput ref={input} field={field} control={control} />}
        </FormField>
      ) : (
        <PasswordField email={email} field={field} hint={hint} error={error} inputRef={input} />
      )}
      {withPassword && (
        <PasswordField
          email={email}
          field={password}
          hint={t('twoFactor.passwordHint')}
          error={password.error ?? (rejected === 'password' ? t('settings.passwordMismatch') : null)}
        />
      )}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
      <div className="flex flex-wrap gap-3">
        <BusyButton type="submit" busy={busy} busyLabel={busyLabel}>
          {submitLabel}
        </BusyButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('settings.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

type Mode = 'idle' | 'setup' | 'regenerate' | 'disable';

/**
 * Settings body for two-step sign-in (contract "Two-factor sign-in"): status with recovery codes left, set up with a
 * QR code and the shared key, recovery codes shown once, new recovery codes, and turning it off.
 */
export function TwoFactorSettings({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: statusKey, queryFn: () => api.twoFactorStatus() });
  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<'off' | 'saved' | null>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const firstStep = useRef<HTMLHeadingElement>(null);

  function settle(next: TwoFactorStatus, text: 'off' | null): void {
    queryClient.setQueryData(statusKey, next);
    setMode('idle');
    setSetup(null);
    setDone(text);
  }

  async function startSetup(): Promise<void> {
    if (starting) return;
    setStarting(true);
    setProblem(null);
    setDone(null);
    try {
      const next = await api.setupTwoFactor();
      flushSync(() => {
        setSetup(next);
        setMode('setup');
      });
      firstStep.current?.focus();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setStarting(false);
    }
  }

  async function enable(code: string, password?: string): Promise<void> {
    const next = await api.enableTwoFactor(code, password);
    settle({ enabled: true, recoveryCodesLeft: next.length }, null);
    setCodes(next);
  }

  async function regenerate(code: string): Promise<void> {
    const next = await api.regenerateRecoveryCodes(code);
    settle({ enabled: true, recoveryCodesLeft: next.length }, null);
    setCodes(next);
  }

  async function disable(secret: string): Promise<void> {
    await api.disableTwoFactor(me.hasPassword ? { password: secret } : { code: secret });
    settle({ enabled: false, recoveryCodesLeft: 0 }, 'off');
  }

  function savedCodes(): void {
    flushSync(() => {
      setCodes(null);
      setDone('saved');
    });
    summary.current?.focus();
  }

  function cancel(): void {
    setMode('idle');
    setSetup(null);
  }

  const current = status.data;
  let body: ReactNode;
  if (!current) {
    body =
      status.isError && !status.isFetching ? (
        <Notice tone="notice" heading={t('twoFactor.loadFailed')}>
          {problemText(status.error) && <p>{problemText(status.error)}</p>}
          <Button type="button" variant="secondary" onClick={() => void status.refetch()}>
            {t('settings.tryAgain')}
          </Button>
        </Notice>
      ) : (
        <div aria-busy="true">
          <span role="status" className="sr-only">
            {t('twoFactor.loading')}
          </span>
          <Skeleton className="h-[44px] rounded-md" />
        </div>
      );
  } else if (codes) {
    body = <RecoveryCodes codes={codes} onDone={savedCodes} />;
  } else if (mode === 'setup' && setup) {
    body = (
      <ol className="flex flex-col gap-6">
        <li className="flex flex-col gap-3">
          <h3 ref={firstStep} tabIndex={-1} className="text-[18px] focus:outline-none">
            {t('twoFactor.setup.step1')}
          </h3>
          <p>{t('twoFactor.setup.scan')}</p>
          <QrCode value={setup.authenticatorUri} label={t('twoFactor.setup.qrLabel')} />
          <p className="text-muted-foreground">{t('twoFactor.setup.cantScan')}</p>
          <GroupedCode value={setup.sharedKey.toUpperCase()} label={t('twoFactor.setup.key')} />
          <CopyButton text={cleanCode(setup.sharedKey).toUpperCase()}>{t('twoFactor.setup.copyKey')}</CopyButton>
        </li>
        <li className="flex flex-col gap-3">
          <h3 className="text-[18px]">{t('twoFactor.setup.step2')}</h3>
          <ConfirmForm
            kind="code"
            email={me.email}
            withPassword={me.hasPassword}
            submitLabel={t('twoFactor.turnOn')}
            busyLabel={t('settings.checking')}
            onSubmit={enable}
            onCancel={cancel}
            focusOnMount={false}
          />
        </li>
      </ol>
    );
  } else if (current.enabled) {
    body = (
      <>
        <p ref={summary} tabIndex={-1} className="focus:outline-none">
          {t('twoFactor.on')} {t('twoFactor.codesLeft', { count: current.recoveryCodesLeft })}
        </p>
        {mode === 'regenerate' ? (
          <ConfirmForm
            kind="code"
            email={me.email}
            hint={t('twoFactor.regenerateHint')}
            submitLabel={t('twoFactor.regenerate')}
            busyLabel={t('twoFactor.regenerating')}
            onSubmit={regenerate}
            onCancel={cancel}
          />
        ) : mode === 'disable' ? (
          <ConfirmForm
            kind={me.hasPassword ? 'password' : 'code'}
            email={me.email}
            hint={me.hasPassword ? t('twoFactor.disableHintPassword') : t('twoFactor.disableHintCode')}
            submitLabel={t('twoFactor.turnOff')}
            busyLabel={t('settings.turningOff')}
            onSubmit={disable}
            onCancel={cancel}
          />
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" className="[overflow-wrap:anywhere]" onClick={() => setMode('regenerate')}>
              {t('twoFactor.regenerate')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode('disable')}>
              {t('twoFactor.turnOff')}
            </Button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p ref={summary} tabIndex={-1} className="focus:outline-none">
          {t('twoFactor.intro')}
        </p>
        <div>
          <BusyButton
            type="button"
            busy={starting}
            busyLabel={t('settings.preparing')}
            onClick={() => void startSetup()}
          >
            {t('twoFactor.setUp')}
          </BusyButton>
        </div>
      </>
    );
  }

  return (
    <>
      {body}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
      <p role="status" className="text-[14px] text-muted-foreground">
        {done === 'off' ? t('twoFactor.offDone') : done === 'saved' ? t('twoFactor.codesSavedDone') : ''}
      </p>
    </>
  );
}
