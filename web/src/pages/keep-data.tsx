import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, useFocusHeadingOnChange, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { KeepLocalButton } from '@/components/local/upgrade-choice';
import { PageHeader } from '@/components/page-header';
import { RecoveryStep } from '@/components/settings/journal-forms';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { UpgradeSummary } from '@/lib/local/types';
import { saveExport } from '@/lib/native/save-file';
import { auth, backup, localMode, upgrade } from '@/lib/services';
import { useStore } from '@/lib/store';

type Step = { step: 'form' } | { step: 'recovery'; code: string } | { step: 'conflict'; message: string };

const passphraseRule: Validator = (value) => {
  if (!value) return 'Please choose a passphrase.';
  return value.length >= 10 ? null : 'Use at least 10 characters. A few words make a good passphrase.';
};
const loginPasswordRule: Validator = (value) => (value ? null : 'Please enter your login password.');
const noRule: Validator = () => null;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "12 habits, 340 check-ins, 8 journal entries": the habits always, the rest when there are any. */
function summaryText(summary: UpgradeSummary): string {
  return [
    plural(summary.habits, 'habit', 'habits'),
    summary.checkIns ? plural(summary.checkIns, 'check-in', 'check-ins') : '',
    summary.notes ? plural(summary.notes, 'journal entry', 'journal entries') : '',
    summary.moods ? plural(summary.moods, 'mood', 'moods') : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * `/keep-data`: after signing in from no-account mode, moves the device data into the account, optionally with the
 * journal end-to-end encrypted on the way (then shows its recovery code once). An account that already has habits
 * gets the choice of another account or staying without one.
 */
export default function KeepDataPage() {
  const navigate = useNavigate();
  const me = useStore(auth.me);
  const summary = useQuery({ queryKey: ['upgrade-summary'], queryFn: () => upgrade.summary() });
  const form = useRef<HTMLFormElement>(null);
  const privateId = useId();
  const [step, setStep] = useState<Step>({ step: 'form' });
  const [privateJournal, setPrivateJournal] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState('');
  useFocusHeadingOnChange(step.step);

  const needsPassword = privateJournal && !!me?.hasPassword;
  const passphrase = useField(privateJournal ? passphraseRule : noRule);
  const confirm = useField((value) =>
    !privateJournal
      ? null
      : !value
        ? 'Please type your passphrase again.'
        : value === passphrase.value
          ? null
          : "The two passphrases don't match yet.",
  );
  const password = useField(needsPassword ? loginPasswordRule : noRule);

  async function move(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (privateJournal && !validateAll(form.current, [passphrase, confirm, password])) return;
    setBusy(true);
    setProblem(null);
    const result = await upgrade
      .run(
        privateJournal
          ? {
              privateJournal: {
                passphrase: passphrase.value,
                remember,
                ...(needsPassword ? { password: password.value } : {}),
              },
            }
          : undefined,
      )
      .catch(
        () =>
          ({ ok: false, reason: 'failed', message: "Your data didn't move this time. You can try again." }) as const,
      );
    if (result.ok) {
      if (result.recoveryCode) setStep({ step: 'recovery', code: result.recoveryCode });
      else await navigate('/today');
      return;
    }
    setBusy(false);
    if (result.reason === 'conflict') setStep({ step: 'conflict', message: result.message });
    else if (result.reason === 'failed') setProblem(result.message);
  }

  async function finish(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await localMode.finishUpgrade();
      await navigate('/today');
    } catch {
      setProblem("That didn't work just now. You can try again.");
      setBusy(false);
    }
  }

  async function exportFirst(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExported('');
    try {
      if (await saveExport(await backup.exportBackup())) {
        await backup.markBackedUp();
        setExported('Backup saved.');
      }
    } catch {
      setExported("The backup couldn't be saved. You can try again.");
    }
    setExporting(false);
  }

  async function otherAccount(): Promise<void> {
    if (leaving) return;
    setLeaving(true);
    if (!(await auth.logout())) setLeaving(false);
  }

  if (step.step === 'recovery') {
    return (
      <>
        <PageHeader title="Your data is in your account" />
        <RecoveryStep code={step.code} onFinish={() => void navigate('/today')} />
      </>
    );
  }

  if (step.step === 'conflict') {
    return (
      <>
        <PageHeader title="This account already has habits" />
        <Notice>
          <p>{step.message}</p>
        </Notice>
        <p className="text-muted-foreground">Your habits are still safe on this device.</p>
        <div className="flex flex-col gap-3">
          <BusyButton
            type="button"
            variant="secondary"
            block
            busy={leaving}
            busyLabel="Signing out…"
            onClick={() => void otherAccount()}
          >
            Use a different account
          </BusyButton>
          <KeepLocalButton />
        </div>
      </>
    );
  }

  const data = summary.data;
  const hasJournal = !!data && data.notes + data.moods > 0;
  const leftOut = [
    data?.leftOut?.notes ? plural(data.leftOut.notes, 'journal entry', 'journal entries') : '',
    data?.leftOut?.lowDays ? plural(data.leftOut.lowDays, 'low day', 'low days') : '',
  ]
    .filter(Boolean)
    .join(' and ');
  return (
    <>
      <PageHeader title="Keep your data" lede="Move what's on this device into your account." />
      {summary.isPending || !me ? (
        <>
          <p role="status" className="sr-only">
            Loading what's on this device…
          </p>
          <Skeleton className="h-[6rem] rounded-xl" />
        </>
      ) : summary.isError ? (
        <Notice tone="notice">
          <p>Ember couldn't read what's on this device just now.</p>
          <Button type="button" variant="secondary" onClick={() => void summary.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : !data ? (
        <>
          <p>There's nothing from this device waiting to move.</p>
          {problem && (
            <Notice tone="notice">
              <p>{problem}</p>
            </Notice>
          )}
          <BusyButton type="button" block busy={busy} busyLabel="One moment…" onClick={() => void finish()}>
            Continue
          </BusyButton>
        </>
      ) : (
        <form ref={form} noValidate onSubmit={(event) => void move(event)} className="flex flex-col gap-4">
          <p>
            On this device: <strong>{summaryText(data)}</strong>.
          </p>
          {leftOut && (
            <Notice>
              <p>
                {leftOut} from before your first habit can't be moved to the account. They stay in your device backup.
              </p>
              <BusyButton
                type="button"
                variant="secondary"
                busy={exporting}
                busyLabel="Preparing…"
                onClick={() => void exportFirst()}
              >
                Export backup first
              </BusyButton>
              <p role="status" className="text-[14px]">
                {exported}
              </p>
            </Notice>
          )}
          {hasJournal && (
            <div className="flex items-start gap-3">
              <div className="flex min-h-[44px] items-center">
                <Checkbox
                  id={privateId}
                  checked={privateJournal}
                  aria-describedby={`${privateId}-hint`}
                  onCheckedChange={(value) => setPrivateJournal(value === true)}
                />
              </div>
              <div className="flex flex-col pt-[10px]">
                <Label htmlFor={privateId} className="font-normal">
                  Keep my journal private (end-to-end encrypted)
                </Label>
                <p id={`${privateId}-hint`} className="text-[14px] text-muted-foreground">
                  Your entries and moods are locked with a passphrase on this device before they move. Ember's server
                  can't read them.
                </p>
              </div>
            </div>
          )}
          {hasJournal && privateJournal && (
            <>
              <FormField
                label="Journal passphrase"
                hint="At least 10 characters. Pick something different from your login password."
                error={passphrase.error}
              >
                {(control) => <PasswordInput {...control} {...passphrase.input} autoComplete="new-password" />}
              </FormField>
              <FormField label="Type it again" error={confirm.error}>
                {(control) => <PasswordInput {...control} {...confirm.input} autoComplete="new-password" />}
              </FormField>
              <div className="flex min-h-[44px] items-center gap-3">
                <Checkbox
                  id={`${privateId}-remember`}
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                />
                <Label htmlFor={`${privateId}-remember`} className="font-normal">
                  Remember on this device
                </Label>
              </div>
              {needsPassword && (
                <>
                  <input
                    className="sr-only"
                    type="email"
                    name="username"
                    autoComplete="username"
                    value={me.email ?? ''}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <FormField
                    label="Your login password"
                    hint="Ember checks it before setting up your journal key."
                    error={password.error}
                  >
                    {(control) => <PasswordInput {...control} {...password.input} autoComplete="current-password" />}
                  </FormField>
                </>
              )}
            </>
          )}
          {problem && (
            <Notice tone="notice">
              <p>{problem}</p>
            </Notice>
          )}
          <BusyButton type="submit" block busy={busy} busyLabel="Moving your data…">
            {problem ? 'Try again' : 'Move my data'}
          </BusyButton>
          <KeepLocalButton />
        </form>
      )}
    </>
  );
}
