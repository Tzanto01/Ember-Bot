import type { LocalDateString, Me } from '@/lib/models';
import { auth } from '@/lib/services';

function todayIn(zone: string): LocalDateString | null {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
  } catch {
    return null;
  }
}

const maxAgeMs = 5 * 60_000;
let seen: { me: Me; at: number } | null = null;

/**
 * Loads `me` again only when it isn't loaded yet, its `localToday` is no longer today in the user's zone, or it was
 * first seen here more than five minutes ago, so changes from other devices show up.
 */
export function loadFreshMe(): Promise<Me | null> {
  const me = auth.me.get();
  if (me && seen?.me !== me) seen = { me, at: Date.now() };
  const stale = !me || me.localToday !== todayIn(me.timezone) || Date.now() - (seen?.at ?? 0) > maxAgeMs;
  return auth.loadMe(stale);
}
