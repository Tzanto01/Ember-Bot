import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { localMode } from '@/lib/services';
import { useStore } from '@/lib/store';

/** "Keep using Ember without an account": leaves `upgrading` mode and goes back to Today. */
export function KeepLocalButton() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function keepLocal(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await localMode.cancelUpgrade();
      await navigate('/today');
    } catch {
      setBusy(false);
    }
  }

  return (
    <BusyButton type="button" variant="secondary" busy={busy} busyLabel="Going back…" onClick={() => void keepLocal()}>
      Keep using Ember without an account
    </BusyButton>
  );
}

/** On sign-in and sign-up while device data waits for an account (mode `upgrading`); nothing otherwise. */
export function UpgradingNotice() {
  if (useStore(localMode.mode) !== 'upgrading') return null;
  return (
    <Notice>
      <p>Your habits from this device come along once you've signed in.</p>
      <KeepLocalButton />
    </Notice>
  );
}

/** The welcome screens' way into no-account mode; hidden while device data already waits for an account. */
export function NoAccountLink() {
  if (useStore(localMode.mode) === 'upgrading') return null;
  return (
    <Button asChild variant="secondary" block>
      <Link to="/local">Use Ember without an account</Link>
    </Button>
  );
}
