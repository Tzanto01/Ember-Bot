import { useEffect } from 'react';
import { LiveRegion } from '@/components/live-region';
import { Notice } from '@/components/ui/notice';
import { deviceSync } from '@/lib/services';
import { useStore } from '@/lib/store';

/** How long the confirmation stays, in milliseconds. */
export const confirmationMs = 4000;

/**
 * The short "checked in" confirmation after "Done" on a reminder or a widget tap (native build), announced
 * politely and cleared after {@link confirmationMs}. Mount it once in the signed-in shell.
 */
export function NativeConfirmation() {
  const checkIn = useStore(deviceSync.nativeCheckIn);

  useEffect(() => {
    if (!checkIn) return;
    const timer = setTimeout(() => deviceSync.nativeCheckIn.set(null), confirmationMs);
    return () => clearTimeout(timer);
  }, [checkIn]);

  const message = checkIn ? `Checked in: ${checkIn.name}` : '';
  return (
    <>
      <LiveRegion message={message} />
      {checkIn && (
        <Notice tone="success" aria-hidden>
          <p>{message}</p>
        </Notice>
      )}
    </>
  );
}
