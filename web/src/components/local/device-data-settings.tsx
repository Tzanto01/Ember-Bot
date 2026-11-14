import { useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { BackupSummary, ParsedBackup } from '@/lib/local/types';
import { saveExport } from '@/lib/native/save-file';
import { auth, backup, localMode } from '@/lib/services';
import { DeviceWarning } from './device-warning';

type Busy = 'export' | 'import' | 'restore' | 'upgrade';

const deleteWord: Validator = (value) => {
  const word = value.trim();
  const expected = t('delete.word');
  if (!word) return t('local.delete.required', { word: expected });
  return word === expected ? null : t('local.delete.capitals', { word: expected });
};

function contents(summary: BackupSummary): string {
  const parts = [
    t('local.count.habits', { count: summary.habits }),
    t('local.count.checkIns', { count: summary.checkIns }),
    t('local.count.lowDays', { count: summary.lowDays }),
    t('local.count.routines', { count: summary.routines }),
    t('local.count.notes', { count: summary.notes }),
    t('local.count.moods', { count: summary.moods }),
  ];
  return t('local.list', { items: parts.slice(0, -1).join(', '), last: parts.at(-1) });
}

/**
 * Settings body "On this device" for no-account mode: the device-only note, backup export and import (with a
 * confirmation before it replaces the device data), and "Create an account and keep my data".
 */
export function DeviceDataSettings() {
  useTranslation();
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
        setDone(t('backup.saved'));
      }
    } catch {
      setProblem(t('backup.saveFailed'));
    }
    setBusy(null);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !begin('import')) return;
    setPending(null);
    if (file.size > 5 * 1024 * 1024) {
      setProblem(t('backup.error.tooBig'));
      setBusy(null);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setProblem(t('local.import.readFailed'));
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
        setDone(t('local.import.restored'));
      });
      status.current?.focus();
    } catch {
      setProblem(t('local.import.restoreFailed'));
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
      setProblem(t('local.upgrade.failed'));
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
          busyLabel={t('backup.preparing')}
          onClick={() => void exportBackup()}
        >
          {t('backup.export')}
        </BusyButton>
        <BusyButton
          ref={importButton}
          type="button"
          variant="secondary"
          busy={busy === 'import'}
          busyLabel={t('local.import.reading')}
          onClick={() => {
            if (!busy) fileInput.current?.click();
          }}
        >
          {t('local.import.button')}
        </BusyButton>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label={t('local.import.fileLabel')}
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
            {t('local.import.confirmHeading')}
          </h3>
          <p>{t('local.import.confirmText', { contents: contents(pending.summary) })}</p>
          {pending.summary.skippedEncrypted > 0 && (
            <p>{t('local.import.skipped', { count: pending.summary.skippedEncrypted })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <BusyButton type="button" busy={busy === 'restore'} busyLabel={t('local.import.restoring')} onClick={() => void restore()}>
              {t('local.import.replace')}
            </BusyButton>
            <Button type="button" variant="ghost" onClick={cancel}>
              {t('local.import.cancel')}
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
      <p ref={status} role="status" tabIndex={-1} className="text-[0.875rem] text-muted-foreground focus:outline-none">
        {done}
      </p>
      <p>{t('local.upgrade.text')}</p>
      <div>
        <BusyButton
          type="button"
          busy={busy === 'upgrade'}
          busyLabel={t('local.upgrade.busy')}
          onClick={() => void createAccount()}
        >
          {t('local.upgrade.button')}
        </BusyButton>
      </div>
    </>
  );
}

/**
 * Settings body "Delete everything on this device" for no-account mode: the typed delete word (`delete.word`), then
 * `localMode.wipe()`.
 */
export function DeleteDeviceData() {
  useTranslation();
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
      setProblem(t('local.delete.failed'));
      setBusy(false);
    }
  }

  return (
    <>
      <p>{t('local.delete.text')}</p>
      <form ref={form} noValidate onSubmit={(event) => void wipe(event)} className="flex flex-col gap-3">
        <FormField label={t('local.delete.label', { word: t('delete.word') })} error={confirm.error}>
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
          <BusyButton type="submit" variant="destructive" busy={busy} busyLabel={t('local.delete.busy')}>
            {t('local.delete.button')}
          </BusyButton>
        </div>
      </form>
    </>
  );
}
