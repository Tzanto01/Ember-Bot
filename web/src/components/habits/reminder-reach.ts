import { useEffect, useState } from 'react';
import { env } from '@/lib/env';
import { auth, localMode, push } from '@/lib/services';
import { useStore } from '@/lib/store';

/**
 * Whether a reminder can reach the user from here: `deliverable` in the app, with Discord linked and its DM reminders
 * not paused, or with a push subscription in this browser; `local` in no-account mode on the web, where reminders
 * can't go out; `none` when an account has no channel yet; `null` while this browser's push subscription is still
 * being read, or when that check failed in a browser that supports push.
 */
export type ReminderReach = 'deliverable' | 'local' | 'none' | null;

const browserPush = () => 'serviceWorker' in navigator && 'PushManager' in window;

/** The Settings card that can turn reminders on here: `push` when it's offered, else `discord`. */
export function useReminderSettingsHash(): 'push' | 'discord' {
  return useStore(push.available) ? 'push' : 'discord';
}

export function useReminderReach(): ReminderReach {
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const subscribed = useStore(push.subscribed);
  const available = useStore(push.available);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (env.native || local) return;
    let live = true;
    void push.check().then(() => {
      if (live) setChecked(true);
    });
    return () => {
      live = false;
    };
  }, [local]);

  if (env.native) return 'deliverable';
  if (local) return 'local';
  if ((me?.discord.linked && !me.dmReminders.paused) || subscribed) return 'deliverable';
  return checked && (available || !browserPush()) ? 'none' : null;
}
