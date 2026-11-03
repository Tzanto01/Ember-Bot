import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
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
  const [problem, setProblem] = useState<string | null>(null);
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
    setProblem(null);
    try {
      if (await saveExport(await backup.exportBackup())) {
        setHidden(true);
        setSaved(true);
      }
    } catch {
      setProblem("The backup couldn't be saved. You can try again.");
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
          <p>
            Ember couldn't find the habits saved on this device. The browser may have cleared its site data. If you
            have a backup, you can import it in Settings.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to="/settings#device">Open Settings</Link>
            </Button>
            <Button type="button" variant="ghost" onClick={dismiss}>
              Got it
            </Button>
          </div>
        </Notice>
      )}
      {due.data === true && !hidden && (
        <Notice>
          <p>It's been a while since your last backup. A copy keeps your habits safe if this device loses them.</p>
          {problem && <p>{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <BusyButton
              type="button"
              variant="secondary"
              busy={busy}
              busyLabel="Preparing…"
              onClick={() => void exportBackup()}
            >
              Export backup
            </BusyButton>
            <Button type="button" variant="ghost" aria-disabled={busy || undefined} onClick={() => void notNow()}>
              Not now
            </Button>
          </div>
        </Notice>
      )}
      {saved && <Notice tone="success">Backup saved.</Notice>}
    </>
  );
}
