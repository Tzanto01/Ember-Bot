import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { http } from '@/lib/services';
import { updateReady } from '@/lib/startup';
import { useStore } from '@/lib/store';

function Dismiss({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Dismiss" className="-my-2 -mr-2 ml-auto" onClick={onClick}>
      <X aria-hidden />
    </Button>
  );
}

/**
 * App-wide toasts above the bottom tab bar, each dismissible: "A new version is ready" with Reload when an update
 * waits ({@link updateReady}), and an offline note while a screen shows habits saved on this device
 * (`Http.offlineData`).
 */
export function UpdateToast() {
  const reload = useStore(updateReady);
  const offline = useStore(http.offlineData);
  const [updateHidden, setUpdateHidden] = useState(false);
  const [offlineHidden, setOfflineHidden] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => setOfflineHidden(false), [offline]);

  const showUpdate = !!reload && !updateHidden;
  const showOffline = offline && !offlineHidden;
  if (!showUpdate && !showOffline) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {showOffline && (
        <Notice tone="info" className="pointer-events-auto w-full max-w-[28rem] bg-card shadow-md">
          <div className="flex w-full items-start gap-2">
            <p>You're offline, so this is what Ember saved on this device. Changes will sync when you're back.</p>
            <Dismiss onClick={() => setOfflineHidden(true)} />
          </div>
        </Notice>
      )}
      {showUpdate && (
        <Notice tone="info" className="pointer-events-auto w-full max-w-[28rem] bg-card shadow-md">
          <div className="flex w-full flex-wrap items-center gap-2">
            <p>A new version is ready.</p>
            <Button
              variant="secondary"
              aria-disabled={reloading || undefined}
              onClick={() => {
                if (reloading) return;
                setReloading(true);
                reload();
              }}
            >
              {reloading ? 'Reloading…' : 'Reload'}
            </Button>
            <Dismiss onClick={() => setUpdateHidden(true)} />
          </div>
        </Notice>
      )}
    </div>
  );
}
