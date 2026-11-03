import { useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import type { BackupSummary, ParsedBackup } from '@/lib/local/types';
import { saveExport } from '@/lib/native/save-file';
import { auth, backup, localMode } from '@/lib/services';
import { DeviceWarning } from './device-warning';

type Busy = 'export' | 'import' | 'restore' | 'upgrade';

const deleteWord: Validator = (value) => {
  const word = value.trim();
  if (!word) return 'Type DELETE to confirm.';
  return word === 'DELETE' ? null : 'Type DELETE in capital letters to confirm.';
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function contents(summary: BackupSummary): string {
  const parts = [
    plural(summary.habits, 'habit', 'habits'),
    plural(summary.checkIns, 'check-in', 'check-ins'),
    plural(summary.lowDays, 'low day', 'low days'),
    plural(summary.routines, 'routine', 'routines'),
    plural(summary.notes, 'journal entry', 'journal entries'),
    plural(summary.moods, 'mood', 'moods'),
  ];
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * Settings body "On this device" for no-account mode: the device-only note, backup export and import (with a
 * confirmation before it replaces the device data), and "Create an account and keep my data".
 */
export function DeviceDataSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const headingId = useId();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState('');

  function begin(next: Busy): boolean {
    if (busy) return false;
    setBusy(next);
    setProblem(null);
    setDone('');
    return true;
  }

  async function exportBackup(): Promise<void> {
    if (!begin('export')) return;
    try {
      if (await saveExport(await backup.exportBackup())) {
        await backup.markBackedUp();
        setDone('Backup saved.');
      }
    } catch {
      setProblem("The backup couldn't be saved. You can try again.");
    }
    setBusy(null);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !begin('import')) return;
    setPending(null);
    if (file.size > 5 * 1024 * 1024) {
      setProblem('This file is too big to be an Ember backup.');
      setBusy(null);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setProblem("Ember couldn't read that file. You can try again.");
      setBusy(null);
      return;
    }
    const parsed = backup.parseBackup(text);
    if ('error' in parsed) {
      setProblem(parsed.error);
      setBusy(null);
      return;
    }
    flushSync(() => {
      setPending(parsed);
      setBusy(null);
    });
    confirmHeading.current?.focus();
  }

  async function restore(): Promise<void> {
    if (!pending || !begin('restore')) return;
    try {
      await backup.restoreBackup(pending);
      await Promise.all([queryClient.invalidateQueries(), auth.loadMe(true).catch(() => null)]);
      flushSync(() => {
        setPending(null);
        setDone('Backup restored.');
      });
      status.current?.focus();
    } catch {
      setProblem("The backup couldn't be restored. Your data on this device is unchanged.");
    }
    setBusy(null);
  }

  function cancel(): void {
    flushSync(() => setPending(null));
    importButton.current?.focus();
  }

  async function createAccount(): Promise<void> {
    if (!begin('upgrade')) return;
    try {
      await localMode.beginUpgrade();
      await navigate('/signup');
    } catch {
      setProblem("That didn't work just now. You can try again.");
      setBusy(null);
    }
  }

  return (
    <>
      <DeviceWarning />
      <div className="flex flex-wrap gap-2">
        <BusyButton
          type="button"
          variant="secondary"
          busy={busy === 'export'}
          busyLabel="Preparing…"
          onClick={() => void exportBackup()}
        >
          Export backup
        </BusyButton>
        <BusyButton
          ref={importButton}
          type="button"
          variant="secondary"
          busy={busy === 'import'}
          busyLabel="Reading…"
          onClick={() => {
            if (!busy) fileInput.current?.click();
          }}
        >
          Import backup
        </BusyButton>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Choose a backup file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => void chooseFile(event)}
        />
      </div>
      {pending && (
        <div
          role="group"
          aria-labelledby={headingId}
          className="flex flex-col gap-3 rounded-md border border-border bg-muted p-4"
        >
          <h3 ref={confirmHeading} id={headingId} tabIndex={-1} className="font-semibold focus:outline-none">
            Replace what's on this device?
          </h3>
          <p>This backup has {contents(pending.summary)}. Restoring it replaces everything on this device now.</p>
          {pending.summary.skippedEncrypted > 0 && (
            <p>
              {plural(
                pending.summary.skippedEncrypted,
                'private journal entry or mood',
                'private journal entries and moods',
              )}{' '}
              in it can only be opened with the account's passphrase, so they're left out.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <BusyButton type="button" busy={busy === 'restore'} busyLabel="Restoring…" onClick={() => void restore()}>
              Replace my data
            </BusyButton>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
      <p ref={status} role="status" tabIndex={-1} className="text-[14px] text-muted-foreground focus:outline-none">
        {done}
      </p>
      <p>Want your habits on more devices? Create an account and bring everything with you.</p>
      <div>
        <BusyButton
          type="button"
          busy={busy === 'upgrade'}
          busyLabel="One moment…"
          onClick={() => void createAccount()}
        >
          Create an account and keep my data
        </BusyButton>
      </div>
    </>
  );
}

/** Settings body "Delete everything on this device" for no-account mode: typed DELETE, then `localMode.wipe()`. */
export function DeleteDeviceData() {
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const confirm = useField(deleteWord);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function wipe(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, [confirm])) return;
    setBusy(true);
    setProblem(null);
    try {
      await localMode.wipe();
      await navigate('/login');
    } catch {
      setProblem("Ember couldn't delete the data on this device. You can try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        This removes your habits, check-ins, low days, routines, journal and settings from this device. It can't be
        undone. If you'd like to keep a copy, export a backup first.
      </p>
      <form ref={form} noValidate onSubmit={(event) => void wipe(event)} className="flex flex-col gap-3">
        <FormField label="Type DELETE to confirm" error={confirm.error}>
          {(field) => (
            <Input
              {...field}
              {...confirm.input}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          )}
        </FormField>
        {problem && (
          <Notice tone="notice">
            <p>{problem}</p>
          </Notice>
        )}
        <div>
          <BusyButton type="submit" variant="destructive" busy={busy} busyLabel="Deleting…">
            Delete everything on this device
          </BusyButton>
        </div>
      </form>
    </>
  );
}
