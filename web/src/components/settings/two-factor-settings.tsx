import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { Me, TwoFactorSetup, TwoFactorStatus } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';
import { QrCode } from './qr-code';
import { CopyButton, GroupedCode, RecoveryCodes } from './secret-codes';
import { CodeInput, cleanCode, codeRule, wrongCodeText } from './two-factor-code';

const statusKey = ['two-factor'] as const;
const passwordRule: Validator = (value) => (value ? null : 'Please enter your password.');
const passwordMismatch = "That password doesn't match. Try again.";

function problemText(error: unknown): string | null {
  const apiError = asApiError(error);
  return apiError.handled ? null : problemToMessage(apiError).message;
}

/**
 * Asks for an authenticator code or the login password, then runs `onSubmit`. A 400 answer is shown as a gentle
 * field error; anything else as a notice under the form.
 */
function ConfirmForm({
  kind,
  email,
  hint,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: {
  kind: 'code' | 'password';
  email: string | null;
  hint?: string;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const field = useField(kind === 'code' ? codeRule : passwordRule);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => input.current?.focus(), []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, [field])) return;
    setBusy(true);
    setRejected(false);
    setProblem(null);
    try {
      await onSubmit(kind === 'code' ? cleanCode(field.value) : field.value);
    } catch (error) {
      if (asApiError(error).status === 400) {
        flushSync(() => setRejected(true));
        focusFirstInvalid(form.current);
      } else {
        setProblem(problemText(error));
      }
    } finally {
      setBusy(false);
    }
  }

  const error =
    field.error ?? (rejected ? (kind === 'code' ? wrongCodeText : passwordMismatch) : null);
  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      {kind === 'code' ? (
        <FormField label="Code from your authenticator app" hint={hint} error={error}>
          {(control) => <CodeInput ref={input} field={field} control={control} />}
        </FormField>
      ) : (
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
          <FormField label="Your password" hint={hint} error={error}>
            {(control) => (
              <PasswordInput
                {...control}
                {...field.input}
                ref={input}
                autoComplete="current-password"
              />
            )}
          </FormField>
        </>
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
            Cancel
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
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: statusKey, queryFn: () => api.twoFactorStatus() });
  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const summary = useRef<HTMLParagraphElement>(null);

  function settle(next: TwoFactorStatus, text: string): void {
    queryClient.setQueryData(statusKey, next);
    setMode('idle');
    setSetup(null);
    setDone(text);
  }

  async function startSetup(): Promise<void> {
    if (starting) return;
    setStarting(true);
    setProblem(null);
    setDone('');
    try {
      setSetup(await api.setupTwoFactor());
      setMode('setup');
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setStarting(false);
    }
  }

  async function enable(code: string): Promise<void> {
    const next = await api.enableTwoFactor(code);
    settle({ enabled: true, recoveryCodesLeft: next.length }, '');
    setCodes(next);
  }

  async function regenerate(code: string): Promise<void> {
    const next = await api.regenerateRecoveryCodes(code);
    settle({ enabled: true, recoveryCodesLeft: next.length }, '');
    setCodes(next);
  }

  async function disable(secret: string): Promise<void> {
    await api.disableTwoFactor(me.hasPassword ? { password: secret } : { code: secret });
    settle(
      { enabled: false, recoveryCodesLeft: 0 },
      'Two-step sign-in is off. Your password alone signs you in again.',
    );
  }

  function savedCodes(): void {
    flushSync(() => {
      setCodes(null);
      setDone('Recovery codes saved. Keep them safe.');
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
        <Notice tone="notice" heading="This didn't load">
          {problemText(status.error) && <p>{problemText(status.error)}</p>}
          <Button type="button" variant="secondary" onClick={() => void status.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : (
        <div aria-busy="true">
          <span role="status" className="sr-only">
            Loading two-step sign-in…
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
          <h3 className="text-[18px]">1. Add Ember to your authenticator app</h3>
          <p>
            Scan this code with an authenticator app on your phone, such as Aegis, 2FAS or Google
            Authenticator.
          </p>
          <QrCode
            value={setup.authenticatorUri}
            label="QR code for adding Ember to your authenticator app"
          />
          <p className="text-muted-foreground">Can't scan it? Enter this key in the app instead.</p>
          <GroupedCode value={setup.sharedKey.toUpperCase()} label="Setup key" />
          <CopyButton text={cleanCode(setup.sharedKey).toUpperCase()}>Copy key</CopyButton>
        </li>
        <li className="flex flex-col gap-3">
          <h3 className="text-[18px]">2. Enter the code it shows</h3>
          <ConfirmForm
            kind="code"
            email={me.email}
            submitLabel="Turn on two-step sign-in"
            busyLabel="Checking…"
            onSubmit={enable}
            onCancel={cancel}
          />
        </li>
      </ol>
    );
  } else if (current.enabled) {
    body = (
      <>
        <p ref={summary} tabIndex={-1} className="focus:outline-none">
          Two-step sign-in is on. After your password, Ember asks for a code from your authenticator
          app.{' '}
          {current.recoveryCodesLeft === 1
            ? 'You have 1 recovery code left.'
            : `You have ${current.recoveryCodesLeft} recovery codes left.`}
        </p>
        {mode === 'regenerate' ? (
          <ConfirmForm
            kind="code"
            email={me.email}
            hint="New codes replace your old ones."
            submitLabel="Get new recovery codes"
            busyLabel="Getting codes…"
            onSubmit={regenerate}
            onCancel={cancel}
          />
        ) : mode === 'disable' ? (
          <ConfirmForm
            kind={me.hasPassword ? 'password' : 'code'}
            email={me.email}
            hint={
              me.hasPassword
                ? 'To turn it off, confirm with your password.'
                : 'To turn it off, confirm with a current code.'
            }
            submitLabel="Turn off two-step sign-in"
            busyLabel="Turning off…"
            onSubmit={disable}
            onCancel={cancel}
          />
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => setMode('regenerate')}>
              Get new recovery codes
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode('disable')}>
              Turn off two-step sign-in
            </Button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p ref={summary} tabIndex={-1} className="focus:outline-none">
          Add a second step when you sign in: after your password, Ember asks for a 6-digit code
          from an authenticator app on your phone. It protects your sign-in; your private journal
          has its own lock.
        </p>
        <div>
          <BusyButton
            type="button"
            busy={starting}
            busyLabel="Preparing…"
            onClick={() => void startSetup()}
          >
            Set up two-step sign-in
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
        {done}
      </p>
    </>
  );
}
