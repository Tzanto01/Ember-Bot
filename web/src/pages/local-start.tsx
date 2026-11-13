import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { DeviceWarning } from '@/components/local/device-warning';
import { MomentDoor } from '@/components/moment/moment-door';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { localMode } from '@/lib/services';

/** `/local`: the one-time "data only on this device" note before starting no-account mode. */
export default function LocalStartPage() {
  const { t } = useTranslation();
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
      <PageHeader title={t('local.start.title')} />
      <div className="flex flex-col gap-3">
        <DeviceWarning />
      </div>
      {failed && (
        <Notice tone="notice">
          <p>{t('local.start.failed')}</p>
        </Notice>
      )}
      <div className="flex flex-col gap-3">
        <BusyButton type="button" block busy={busy} busyLabel={t('local.start.busy')} onClick={() => void start()}>
          {t('local.start.button')}
        </BusyButton>
        <Button asChild variant="ghost" block>
          <Link to="/login">{t('local.start.back')}</Link>
        </Button>
      </div>
      <p className="text-center">
        <MomentDoor variant="quiet" />
      </p>
    </>
  );
}
