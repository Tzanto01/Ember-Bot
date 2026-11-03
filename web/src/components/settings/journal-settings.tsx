import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton } from '@/components/auth/busy-button';
import { journalKey } from '@/components/journal/day-journal';
import { useJournal } from '@/components/journal/journal-context';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';
import type { Me } from '@/lib/models';
import { openOnWeb } from '@/lib/native/browser';
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
  'your email and Discord ID',
  'habit and routine names (the Discord bot and reminders need them)',
  'check-ins and their times',
  'low days',
];

function leftText(left: number): string {
  return left === 1 ? '1 entry or mood to go.' : `${left} entries and moods to go.`;
}

/**
 * Settings body for the private journal (contract "Private journal"), following `journal.state`: turn it on (with
 * the one-time recovery code), unlock this device (passphrase or recovery code, then a new passphrase), "lost
 * both", change passphrase, lock this device, decrypted export (web) and turning it off, including finishing a
 * switch-off that is under way (`journal.turningOff`). Secrets stay in the forms'
 * state and go when they close.
 */
export function JournalSettings({ me }: { me: Me }) {
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
    setProblem(
      'That took a while, so the journal locked again. Unlock it with your recovery code once more.',
    );
  }

  async function lock(): Promise<void> {
    if (busy) return;
    setBusy('lock');
    await journal.forget();
    queryClient.removeQueries({ queryKey: journalKey });
    setBusy(null);
    announce('Locked on this device. Unlock it with your passphrase whenever you like.');
  }

  async function exportJournal(): Promise<void> {
    if (busy) return;
    setBusy('export');
    setProblem(null);
    try {
      saveFile(await journal.exportDecrypted());
    } catch (error) {
      setProblem(journalProblem(error));
    } finally {
      setBusy(null);
    }
  }

  const progress = (
    <p role="status" className="text-muted-foreground">
      {left > 0 ? `Encrypting your journal: ${leftText(left)}` : 'Setting up encryption…'}
    </p>
  );

  const encryptedLeft = turningOff ? me.journal.encryptedLeft : 0;
  const decrypting = encryptedLeft > 0 && (
    <p role="status" className="text-muted-foreground">
      {encryptedLeft === 1
        ? 'Decrypting your journal: 1 entry or mood to go.'
        : `Decrypting your journal: ${encryptedLeft} entries and moods to go.`}
    </p>
  );

  let body;
  if (flow?.step === 'recovery') {
    body = (
      <RecoveryStep code={flow.code} onFinish={() => announce('Your private journal is ready.')} />
    );
  } else if (flow?.step === 'new-passphrase') {
    body = (
      <>
        <p>
          Your recovery code worked. Choose a new passphrase to finish unlocking; your recovery code
          stays the same.
        </p>
        <PassphraseForm
          me={me}
          current={false}
          submitLabel="Save new passphrase"
          onDone={() =>
            announce('Your new passphrase is set. Your journal is unlocked on this device.')
          }
          onExpired={() => void expired()}
        />
      </>
    );
  } else if (state === 'off' || flow?.step === 'enabling') {
    body = (
      <>
        <p>
          Your journal is already private to your account. The private journal goes one step
          further: entries and your own moods are encrypted on your device before they're sent, so
          only you can read them. Not even Ember's server can.
        </p>
        <div className="flex flex-col gap-1">
          <p>What Ember's server can still read, by design:</p>
          <ul className="list-disc pl-6">
            {readable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <Notice tone="info" heading="Keep two things safe">
          <p>
            Your passphrase and a recovery code (shown once) are the only ways in. If you lose both,
            nobody can open your journal again, Ember included. You could only delete it and start
            fresh.
          </p>
        </Notice>
        <EnableForm me={me} onSubmit={enable} progress={progress} />
      </>
    );
  } else if (state === 'locked') {
    body = (
      <>
        <p>
          {turningOff
            ? 'Ember is turning your private journal back into a plain one. Unlock it on this device to carry on.'
            : 'Your private journal is locked on this device. Unlock it to read and write entries here.'}
        </p>
        {panel === 'discard' ? (
          <>
            <Notice tone="info" heading="Delete the private journal">
              <p>
                This deletes every private journal entry and your own moods for good, then turns the
                private journal off. Your habits, check-ins and low days stay.
              </p>
            </Notice>
            <ConfirmJournalForm
              me={me}
              typeDelete
              submitLabel="Delete my private journal"
              busyLabel="Deleting…"
              onSubmit={async (password) => {
                await journal.discard(password);
                announce(
                  'Your private journal is deleted and turned off. You can start a fresh one any time.',
                );
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
                  : announce('Unlocked on this device.')
              }
            />
            <div>
              <Button type="button" variant="link" className="px-0" onClick={() => open('discard')}>
                I lost both my passphrase and recovery code
              </Button>
            </div>
          </>
        )}
      </>
    );
  } else if (turningOff && panel !== 'disable') {
    body = (
      <>
        <Notice tone="info" heading="Turning your private journal off">
          <p>
            Your entries and own moods are being decrypted on this device and saved to your account
            readable again. Confirm to finish.
          </p>
        </Notice>
        {decrypting}
        <ConfirmJournalForm
          me={me}
          submitLabel="Finish turning off"
          busyLabel="Turning off…"
          onSubmit={async (password) => {
            await journal.disable(password);
            announce('The private journal is off. Your entries are back to normal.');
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <p>
          Your private journal is on and unlocked on this device. Entries and your own moods are
          encrypted here before they're sent.
        </p>
        {left > 0 && progress}
        {panel === 'change' ? (
          <PassphraseForm
            me={me}
            current
            submitLabel="Change passphrase"
            onDone={() => announce('Your passphrase is changed.')}
            onCancel={() => open(null)}
          />
        ) : panel === 'disable' ? (
          <>
            <p>
              Your entries and own moods are decrypted on this device and saved to your account
              readable again, like before.
            </p>
            {decrypting}
            <ConfirmJournalForm
              me={me}
              submitLabel="Turn off the private journal"
              busyLabel="Turning off…"
              onSubmit={async (password) => {
                await journal.disable(password);
                announce('The private journal is off. Your entries are back to normal.');
              }}
              onCancel={() => open(null)}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={() => open('change')}>
                Change passphrase
              </Button>
              <BusyButton
                type="button"
                variant="secondary"
                busy={busy === 'lock'}
                busyLabel="Locking…"
                onClick={() => void lock()}
              >
                Lock on this device
              </BusyButton>
            </div>
            {env.native ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-muted-foreground">
                  Exporting your decrypted journal works on the web.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void openOnWeb('/settings#journal')}
                >
                  Export on the web
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <BusyButton
                  type="button"
                  variant="secondary"
                  busy={busy === 'export'}
                  busyLabel="Preparing…"
                  onClick={() => void exportJournal()}
                >
                  Export my journal (decrypted)
                </BusyButton>
                <p className="text-[14px] text-muted-foreground">
                  The file isn't encrypted, so keep it somewhere private.
                </p>
              </div>
            )}
            <div>
              <Button type="button" variant="link" className="px-0" onClick={() => open('disable')}>
                Turn off the private journal
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
