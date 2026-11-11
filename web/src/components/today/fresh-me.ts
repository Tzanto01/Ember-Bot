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

/** Loads `me` again only when it isn't loaded yet or its `localToday` is no longer today in the user's zone. */
export function loadFreshMe(): Promise<Me | null> {
  const me = auth.me.get();
  return auth.loadMe(!me || me.localToday !== todayIn(me.timezone));
}
