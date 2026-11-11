import { Link } from 'react-router';
import { Notice } from '@/components/ui/notice';
import { env } from '@/lib/env';
import type { ReminderChannel } from '@/lib/models';
import { push, reminders } from '@/lib/services';

/** The channel that shows reminders on this device: `mobile` in the app, `webpush` in the browser. */
export function deviceChannel(): ReminderChannel {
  return env.native ? 'mobile' : 'webpush';
}

/** True when asking makes sense here: always in the app, in the browser while the server offers push. */
export function canAskDevice(): boolean {
  return env.native || push.available.get();
}

/**
 * Makes sure reminders can show on this device: in the app the system notification prompt (none once granted), in
 * the browser the push subscription Settings uses (the browser prompt, skipped once this browser is subscribed).
 * True when they can; false when denied or unavailable. Never throws.
 */
export async function allowDeviceReminders(): Promise<boolean> {
  if (env.native) return (await reminders?.requestPermission().catch(() => false)) ?? false;
  await push.check();
  if (push.subscribed.get()) return true;
  if (!push.available.get()) return false;
  return push.subscribe().then(
    () => push.subscribed.get(),
    () => false,
  );
}

/** The notice after {@link allowDeviceReminders} answered false, linking to the Settings card that can fix it. */
export function DeviceRemindersOff() {
  return env.native ? (
    <Notice tone="notice">
      <p>Notifications are off for Ember on this phone. Turn them on in your phone settings so reminders can arrive.</p>
      <Link to={{ pathname: '/settings', hash: 'phone-reminders' }}>Reminders on this phone</Link>
    </Notice>
  ) : (
    <Notice tone="notice">
      <p>Notifications are off for Ember in this browser, so reminders can't show here yet.</p>
      <Link to={{ pathname: '/settings', hash: 'push' }}>Turn them on in Settings</Link>
    </Notice>
  );
}
