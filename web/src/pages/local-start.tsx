import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { DeviceWarning } from '@/components/local/device-warning';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { localMode } from '@/lib/services';

/** `/local`: the one-time "data only on this device" note before starting no-account mode. */
export default function LocalStartPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await localMode.start();
      await navigate('/today');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Use Ember without an account" />
      <div className="flex flex-col gap-3">
        <DeviceWarning />
      </div>
      {failed && (
        <Notice tone="notice">
          <p>Ember couldn't set itself up on this device. You can try again.</p>
        </Notice>
      )}
      <div className="flex flex-col gap-3">
        <BusyButton type="button" block busy={busy} busyLabel="Starting…" onClick={() => void start()}>
          Start without an account
        </BusyButton>
        <Button asChild variant="ghost" block>
          <Link to="/login">Back</Link>
        </Button>
      </div>
    </>
  );
}
