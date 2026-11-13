import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BusyButton } from '@/components/auth/busy-button';
import { journalKey } from '@/components/journal/day-journal';
import { useJournal } from '@/components/journal/journal-context';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { Me } from '@/lib/models';
import { saveExport } from '@/lib/native/save-file';
import { useStore } from '@/lib/store';
import {
  ConfirmJournalForm,
  EnableForm,
  journalProblem,
  PassphraseForm,
  RecoveryStep,
  UnlockForm,
} from './journal-forms';

type Flow =
  { step: 'enabling' } | { step: 'recovery'; code: string } | { step: 'new-passphrase' } | null;
type Panel = 'change' | 'disable' | 'discard' | null;

const readable = [
  'journalSettings.readable.identity',
  'journalSettings.readable.names',
  'journalSettings.readable.checkIns',
  'journalSettings.readable.lowDays',
] as const;

/**
 * Settings body for the private journal (contract "Private journal"), following `journal.state`: turn it on (with
 * the one-time recovery code), unlock this device (passphrase or recovery code, then a new passphrase), "lost
 * both", change passphrase, lock this device, decrypted export (web) and turning it off, including finishing a
 * switch-off that is under way (`journal.turningOff`). Secrets stay in the forms'
 * state and go when they close.
 */
export function JournalSettings({ me }: { me: Me }) {
  const { t } = useTranslation();
  const journal = useJournal();
  const queryClient = useQueryClient();
  const state = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
  const [flow, setFlow] = useState<Flow>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<'lock' | 'export' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const status = useRef<HTMLParagraphElement>(null);

  const left = me.journal.encrypted ? me.journal.plaintextLeft : 0;

  function announce(text: string): void {
    flushSync(() => {
      setFlow(null);
      setPanel(null);
      setProblem(null);
      setDone(text);
    });
    status.current?.focus();
  }

  function open(next: Panel): void {
    setPanel(next);
    setProblem(null);
    setDone('');
  }

  async function enable(passphrase: string, remember: boolean, password?: string): Promise<void> {
    setFlow({ step: 'enabling' });
    setDone('');
    try {
      const { recoveryCode } = await journal.enable(passphrase, remember, password);
      setFlow({ step: 'recovery', code: recoveryCode });
    } catch (error) {
      setFlow(null);
      throw error;
    }
  }

  async function expired(): Promise<void> {
    await journal.forget();
    setFlow(null);
    setProblem(t('journalSettings.expired'));
  }

  async function lock(): Promise<void> {
    if (busy) return;
    setBusy('lock');
    await journal.forget();
    queryClient.removeQueries({ queryKey: journalKey });
    setBusy(null);
    announce(t('journalSettings.lockedDone'));
  }

  async function exportJournal(): Promise<void> {
    if (busy) return;
    setBusy('export');
    setProblem(null);
    try {
      await saveExport(await journal.exportDecrypted());
    } catch (error) {
      setProblem(journalProblem(error));
    } finally {
      setBusy(null);
    }
  }

  const progress = (
    <p role="status" className="text-muted-foreground">
      {left > 0 ? t('journalSettings.encrypting', { count: left }) : t('journalSettings.settingUp')}
    </p>
  );

  const encryptedLeft = turningOff ? me.journal.encryptedLeft : 0;
  const decrypting = encryptedLeft > 0 && (
    <p role="status" className="text-muted-foreground">
      {t('journalSettings.decrypting', { count: encryptedLeft })}
    </p>
  );

  let body;
  if (flow?.step === 'recovery') {
    body = (
      <RecoveryStep code={flow.code} onFinish={() => announce(t('journalSettings.ready'))} />
    );
  } else if (flow?.step === 'new-passphrase') {
    body = (
      <>
        <p>{t('journalSettings.recoveryWorked')}</p>
        <PassphraseForm
          me={me}
          current={false}
          submitLabel={t('journalSettings.saveNewPassphrase')}
          onDone={() => announce(t('journalSettings.newPassphraseDone'))}
          onExpired={() => void expired()}
        />
      </>
    );
  } else if (state === 'off' || flow?.step === 'enabling') {
    body = (
      <>
        <p>{t('journalSettings.offIntro')}</p>
        <div className="flex flex-col gap-1">
          <p>{t('journalSettings.readableIntro')}</p>
          <ul className="list-disc pl-6">
            {readable.map((item) => (
              <li key={item}>{t(item)}</li>
            ))}
          </ul>
        </div>
        <Notice tone="info" heading={t('journalSettings.keepSafe.heading')}>
          <p>{t('journalSettings.keepSafe.text')}</p>
        </Notice>
        <EnableForm me={me} onSubmit={enable} progress={progress} />
      </>
    );
  } else if (state === 'locked') {
    body = (
      <>
        <p>
          {turningOff ? t('journalSettings.lockedTurningOff') : t('journalSettings.locked')}
        </p>
        {panel === 'discard' ? (
          <>
            <Notice tone="info" heading={t('journalSettings.discard.heading')}>
              <p>{t('journalSettings.discard.text')}</p>
            </Notice>
            <ConfirmJournalForm
              me={me}
              typeDelete
              submitLabel={t('journalSettings.discard.submit')}
              busyLabel={t('settings.delete.deleting')}
              onSubmit={async (password) => {
                await journal.discard(password);
                announce(t('journalSettings.discard.done'));
              }}
              onCancel={() => open(null)}
            />
          </>
        ) : (
          <>
            <UnlockForm
              onUnlocked={(needsNewPassphrase) =>
                needsNewPassphrase && !turningOff
                  ? setFlow({ step: 'new-passphrase' })
                  : announce(t('journalSettings.unlockedDone'))
              }
            />
            <div>
              <Button type="button" variant="link" className="px-0" onClick={() => open('discard')}>
                {t('journalSettings.lostBoth')}
              </Button>
            </div>
          </>
        )}
      </>
    );
  } else if (turningOff && panel !== 'disable') {
    body = (
      <>
        <Notice tone="info" heading={t('journalSettings.finishOff.heading')}>
          <p>{t('journalSettings.finishOff.text')}</p>
        </Notice>
        {decrypting}
        <ConfirmJournalForm
          me={me}
          submitLabel={t('journalSettings.finishOff.submit')}
          busyLabel={t('settings.turningOff')}
          onSubmit={async (password) => {
            await journal.disable(password);
            announce(t('journalSettings.offDone'));
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <p>{t('journalSettings.unlocked')}</p>
        {left > 0 && progress}
        {panel === 'change' ? (
          <PassphraseForm
            me={me}
            current
            submitLabel={t('journalSettings.changePassphrase')}
            onDone={() => announce(t('journalSettings.passphraseChanged'))}
            onCancel={() => open(null)}
          />
        ) : panel === 'disable' ? (
          <>
            <p>{t('journalSettings.disableText')}</p>
            {decrypting}
            <ConfirmJournalForm
              me={me}
              submitLabel={t('journalSettings.turnOff')}
              busyLabel={t('settings.turningOff')}
              onSubmit={async (password) => {
                await journal.disable(password);
                announce(t('journalSettings.offDone'));
              }}
              onCancel={() => open(null)}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={() => open('change')}>
                {t('journalSettings.changePassphrase')}
              </Button>
              <BusyButton
                type="button"
                variant="secondary"
                busy={busy === 'lock'}
                busyLabel={t('journalSettings.locking')}
                onClick={() => void lock()}
              >
                {t('journalSettings.lock')}
              </BusyButton>
            </div>
            <div className="flex flex-col items-start gap-2">
              <BusyButton
                type="button"
                variant="secondary"
                busy={busy === 'export'}
                busyLabel={t('settings.preparing')}
                onClick={() => void exportJournal()}
              >
                {t('journalSettings.export')}
              </BusyButton>
              <p className="text-[14px] text-muted-foreground">{t('journalSettings.exportHint')}</p>
            </div>
            <div>
              <Button type="button" variant="link" className="px-0" onClick={() => open('disable')}>
                {t('journalSettings.turnOff')}
              </Button>
            </div>
          </>
        )}
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
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        className="text-[14px] text-muted-foreground focus:outline-none"
      >
        {done}
      </p>
    </>
  );
}
