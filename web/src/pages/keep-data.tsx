import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
import { t as translate } from '@/lib/i18n';
import type { UpgradeSummary } from '@/lib/local/types';
import { saveExport } from '@/lib/native/save-file';
import { auth, backup, localMode, upgrade } from '@/lib/services';
import { useStore } from '@/lib/store';

type Step = { step: 'form' } | { step: 'recovery'; code: string } | { step: 'conflict'; message: string };

const passphraseRule: Validator = (value) => {
  if (!value) return translate('keepData.passphrase.required');
  return value.length >= 10 ? null : translate('keepData.passphrase.short');
};
const loginPasswordRule: Validator = (value) => (value ? null : translate('keepData.password.required'));
const noRule: Validator = () => null;


/** "12 habits, 340 check-ins, 8 journal entries": the habits always, the rest when there are any. */
function summaryText(summary: UpgradeSummary): string {
  return [
    translate('keepData.count.habits', { count: summary.habits }),
    summary.checkIns ? translate('keepData.count.checkIns', { count: summary.checkIns }) : '',
    summary.notes ? translate('keepData.count.notes', { count: summary.notes }) : '',
    summary.moods ? translate('keepData.count.moods', { count: summary.moods }) : '',
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
  const { t } = useTranslation();
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

  const [checked, setChecked] = useState(false);
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    void upgrade
      .pendingRecoveryCode()
      .then((code) => {
        if (code) setStep({ step: 'recovery', code });
      })
      .finally(() => setChecked(true));
  }, [meId]);

  const needsPassword = privateJournal && !!me?.hasPassword;
  const passphrase = useField(privateJournal ? passphraseRule : noRule);
  const confirm = useField((value) =>
    !privateJournal
      ? null
      : !value
        ? t('keepData.confirm.required')
        : value === passphrase.value
          ? null
          : t('keepData.confirm.mismatch'),
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
          ({ ok: false, reason: 'failed', message: t('keepData.moveFailed') }) as const,
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
      setProblem(t('keepData.finishFailed'));
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
        setExported(t('backup.saved'));
      }
    } catch {
      setExported(t('backup.saveFailed'));
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
        <PageHeader title={t('keepData.recovery.title')} />
        <RecoveryStep
          code={step.code}
          onFinish={() =>
            void upgrade.acknowledge().then(
              () => navigate('/today'),
              () => undefined,
            )
          }
        />
      </>
    );
  }

  if (step.step === 'conflict') {
    return (
      <>
        <PageHeader title={t('keepData.conflict.title')} />
        <Notice>
          <p>{step.message}</p>
        </Notice>
        <p className="text-muted-foreground">{t('keepData.conflict.safe')}</p>
        <div className="flex flex-col gap-3">
          <BusyButton
            type="button"
            variant="secondary"
            block
            busy={leaving}
            busyLabel={t('keepData.conflict.signingOut')}
            onClick={() => void otherAccount()}
          >
            {t('keepData.conflict.otherAccount')}
          </BusyButton>
          <KeepLocalButton />
        </div>
      </>
    );
  }

  const data = summary.data;
  const hasJournal = !!data && data.notes + data.moods > 0;
  const leftOutNotes = data?.leftOut?.notes ? t('keepData.count.notes', { count: data.leftOut.notes }) : '';
  const leftOutLowDays = data?.leftOut?.lowDays ? t('keepData.count.lowDays', { count: data.leftOut.lowDays }) : '';
  const leftOut =
    leftOutNotes && leftOutLowDays
      ? t('keepData.leftOut.both', { first: leftOutNotes, second: leftOutLowDays })
      : leftOutNotes || leftOutLowDays;
  return (
    <>
      <PageHeader title={t('keepData.title')} lede={t('keepData.lede')} />
      {summary.isPending || !me || !checked ? (
        <>
          <p role="status" className="sr-only">
            {t('keepData.loading')}
          </p>
          <Skeleton className="h-[6rem] rounded-xl" />
        </>
      ) : summary.isError ? (
        <Notice tone="notice">
          <p>{t('keepData.readFailed')}</p>
          <Button type="button" variant="secondary" onClick={() => void summary.refetch()}>
            {t('keepData.retry')}
          </Button>
        </Notice>
      ) : !data ? (
        <>
          <p>{t('keepData.nothing')}</p>
          {problem && (
            <Notice tone="notice">
              <p>{problem}</p>
            </Notice>
          )}
          <BusyButton type="button" block busy={busy} busyLabel={t('keepData.finishing')} onClick={() => void finish()}>
            {t('keepData.continue')}
          </BusyButton>
        </>
      ) : (
        <form ref={form} noValidate onSubmit={(event) => void move(event)} className="flex flex-col gap-4">
          <p>
            <Trans
              i18nKey="keepData.onDevice"
              values={{ summary: summaryText(data) }}
              components={{ strong: <strong /> }}
            />
          </p>
          {leftOut && (
            <Notice>
              <p>{t('keepData.leftOut.text', { items: leftOut })}</p>
              <BusyButton
                type="button"
                variant="secondary"
                busy={exporting}
                busyLabel={t('backup.preparing')}
                onClick={() => void exportFirst()}
              >
                {t('keepData.exportFirst')}
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
                  {t('keepData.private.label')}
                </Label>
                <p id={`${privateId}-hint`} className="text-[14px] text-muted-foreground">
                  {t('keepData.private.hint')}
                </p>
              </div>
            </div>
          )}
          {hasJournal && privateJournal && (
            <>
              <FormField
                label={t('keepData.passphrase.label')}
                hint={t('keepData.passphrase.hint')}
                error={passphrase.error}
              >
                {(control) => <PasswordInput {...control} {...passphrase.input} autoComplete="new-password" />}
              </FormField>
              <FormField label={t('keepData.confirm.label')} error={confirm.error}>
                {(control) => <PasswordInput {...control} {...confirm.input} autoComplete="new-password" />}
              </FormField>
              <div className="flex min-h-[44px] items-center gap-3">
                <Checkbox
                  id={`${privateId}-remember`}
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                />
                <Label htmlFor={`${privateId}-remember`} className="font-normal">
                  {t('keepData.remember')}
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
                    label={t('keepData.password.label')}
                    hint={t('keepData.password.hint')}
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
          <BusyButton type="submit" block busy={busy} busyLabel={t('keepData.moving')}>
            {problem ? t('keepData.retry') : t('keepData.move')}
          </BusyButton>
          <KeepLocalButton />
        </form>
      )}
    </>
  );
}
