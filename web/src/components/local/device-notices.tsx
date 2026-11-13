import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveExport } from '@/lib/native/save-file';
import { backup, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';

let evictedDismissed = false;

function focusHeading(): void {
  document.querySelector<HTMLElement>('#main h1')?.focus();
}

/**
 * Today's notices in no-account mode: device data that went missing (dismissible for this app session) and the
 * gentle 30-day backup reminder. Nothing in account mode.
 */
export function DeviceNotices() {
  const { t } = useTranslation();
  const local = useStore(localMode.mode) === 'local';
  const evicted = useStore(localMode.evicted);
  const due = useQuery({
    queryKey: ['backup-reminder'],
    queryFn: () => backup.backupReminderDue(),
    enabled: local,
  });
  const [dismissed, setDismissed] = useState(evictedDismissed);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!local) return null;

  function dismiss(): void {
    evictedDismissed = true;
    flushSync(() => setDismissed(true));
    focusHeading();
  }

  async function exportBackup(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(false);
    try {
      if (await saveExport(await backup.exportBackup())) {
        await backup.markBackedUp();
        setHidden(true);
        setSaved(true);
      }
    } catch {
      setProblem(true);
    }
    setBusy(false);
  }

  async function notNow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    await backup.snoozeBackupReminder().catch(() => undefined);
    flushSync(() => setHidden(true));
    focusHeading();
  }

  return (
    <>
      {evicted && !dismissed && (
        <Notice>
          <p>{t('backup.evicted')}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/settings#device">{t('backup.openSettings')}</Link>
            </Button>
            <Button type="button" variant="ghost" onClick={dismiss}>
              {t('backup.gotIt')}
            </Button>
          </div>
        </Notice>
      )}
      {due.data === true && !hidden && (
        <Notice>
          <p>{t('backup.reminder')}</p>
          {problem && <p>{t('backup.saveFailed')}</p>}
          <div className="flex flex-wrap gap-2">
            <BusyButton
              type="button"
              variant="secondary"
              busy={busy}
              busyLabel={t('backup.preparing')}
              onClick={() => void exportBackup()}
            >
              {t('backup.export')}
            </BusyButton>
            <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={() => void notNow()}>
              {t('backup.notNow')}
            </Button>
          </div>
        </Notice>
      )}
      {saved && <Notice tone="success">{t('backup.saved')}</Notice>}
    </>
  );
}
