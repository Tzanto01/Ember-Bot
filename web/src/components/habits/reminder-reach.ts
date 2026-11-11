import { useEffect, useState } from 'react';
import { env } from '@/lib/env';
import { auth, localMode, push } from '@/lib/services';
import { useStore } from '@/lib/store';

/**
 * Whether a reminder can reach the user from here: `deliverable` in the app, with Discord linked or with a push
 * subscription in this browser; `local` in no-account mode on the web, where reminders can't go out; `none` when an
 * account has no channel yet; `null` while this browser's push subscription is still being read.
 */
export type ReminderReach = 'deliverable' | 'local' | 'none' | null;

export function useReminderReach(): ReminderReach {
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const subscribed = useStore(push.subscribed);
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
  if (me?.discord.linked || subscribed) return 'deliverable';
  return checked ? 'none' : null;
}
