import { useEffect } from 'react';
import { useReminderDestinations } from '@/components/habits/device-reminders';
import { env } from '@/lib/env';
import { auth, localMode, push } from '@/lib/services';
import { useStore } from '@/lib/store';

/**
 * Whether a reminder can reach the user from here: `deliverable` with an account when at least one of its reminder
 * destinations is on (Discord only while its DM reminders aren't paused), or in no-account mode in the app; `local`
 * in no-account mode on the web, where reminders can't go out; `none` when no destination of the account is on;
 * `null` while the destinations load or when that failed.
 */
export type ReminderReach = 'deliverable' | 'local' | 'none' | null;

/** The Settings card that can turn reminders on here: `push` when it's offered, else `discord`. */
export function useReminderSettingsHash(): 'push' | 'discord' {
  return useStore(push.available) ? 'push' : 'discord';
}

export function useReminderReach(): ReminderReach {
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const destinations = useReminderDestinations(!local);

  useEffect(() => {
    if (!env.native && !local) void push.check();
  }, [local]);

  if (local) return env.native ? 'deliverable' : 'local';
  if (!destinations.data) return null;
  const paused = !!me?.dmReminders.paused;
  return destinations.data.some((d) => d.enabled && !(paused && d.kind === 'discord')) ? 'deliverable' : 'none';
}
