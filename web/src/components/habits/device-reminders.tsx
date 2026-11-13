import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { env } from '@/lib/env';
import type { ReminderChannel, ReminderDestination } from '@/lib/models';
import { api, push, reminders } from '@/lib/services';

/** Query key of `GET /api/me/reminder-destinations`, shared by Settings and the habit and routine editors. */
export const reminderDestinationsKey = ['reminder-destinations'];

/** The account's reminder destinations (v1.14); pass `enabled: false` without an account. */
export function useReminderDestinations(enabled = true) {
  return useQuery({ queryKey: reminderDestinationsKey, queryFn: () => api.listReminderDestinations(), enabled });
}

/** A destination's label, plus a "This phone" or "This browser" badge when it is this device. */
export function DestinationName({ destination }: { destination: ReminderDestination }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="[overflow-wrap:anywhere]">{destination.label}</span>
      {destination.current && <span className="sr-only">,</span>}{' '}
      {destination.current && <Badge>{destination.kind === 'phone' ? t('habitFields.thisPhone') : t('habitFields.thisBrowser')}</Badge>}
    </>
  );
}

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
  const { t } = useTranslation();
  return env.native ? (
    <Notice tone="notice">
      <p>{t('habitFields.offPhone')}</p>
      <Link to={{ pathname: '/settings', hash: 'phone-reminders' }}>{t('habitFields.offPhoneLink')}</Link>
    </Notice>
  ) : (
    <Notice tone="notice">
      <p>{t('habitFields.offBrowser')}</p>
      <Link to={{ pathname: '/settings', hash: 'push' }}>{t('habitFields.offBrowserLink')}</Link>
    </Notice>
  );
}
