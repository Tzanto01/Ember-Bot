import type { AuthService } from './auth';
import { env } from './env';
import type { LocalDateString, Me } from './models';
import type { AppMode } from './local/types';
import { queryString } from './navigation';
import { ApiError, asApiError } from './problem';
import { auth, localMode } from './services';
import type { Store } from './store';

const offlineMeKey = 'ember.offlineMe';

/** How long the signed-in guard trusts an unreachable API before asking it again. */
export const unreachableMs = 30_000;
let unreachableUntil = 0;

/** Lets the signed-in guard ask the API again right away, for example once the browser is back online. */
export function forgetUnreachable(): void {
  unreachableUntil = 0;
}

/** Today's date in `timeZone` by this device's clock, or null for an unknown zone. */
export function deviceToday(timeZone: string, now = new Date()): LocalDateString | null {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return null;
  }
}

/** Keeps the signed-in user on this device for an offline cold start (web build); null forgets it. */
export function rememberMe(me: Me | null): void {
  try {
    if (me) localStorage.setItem(offlineMeKey, JSON.stringify(me));
    else localStorage.removeItem(offlineMeKey);
  } catch {
    return;
  }
}

/** The user {@link rememberMe} kept, only while its `localToday` is still today on this device; else null. */
export function rememberedMe(now = new Date()): Me | null {
  try {
    const me = JSON.parse(localStorage.getItem(offlineMeKey) ?? 'null') as Me | null;
    return me && me.localToday === deviceToday(me.timezone, now) ? me : null;
  } catch {
    return null;
  }
}

/**
 * Signed-in route guard for `url` (path plus query): null lets the user through (loads `me` once).
 * Signed out → `/login?returnUrl=…` (forgetting the {@link rememberedMe}); API unreachable → the same with
 * `reason=offline`. Offers the consent step
 * once per app session when consent is missing, which also covers the return from Discord sign-in. While device
 * data waits for the account (mode `upgrading`), sends the user to `/keep-data` (after the consent step).
 * Web build, API unreachable (status 0) with a {@link rememberedMe} from today: lets the user through on that cached
 * `me` (without marking it loaded, so the next navigation asks the server again) and leaves the consent step for later.
 * After the API was unreachable, the next {@link unreachableMs} of navigations take the offline path without asking
 * again (on the `me` already shown, else the remembered one).
 */
export async function signedIn(
  url: string,
  session: AuthService = auth,
  mode: Store<AppMode> = localMode.mode,
): Promise<string | null> {
  const recentlyUnreachable = Date.now() < unreachableUntil;
  try {
    if (recentlyUnreachable && !session.hasLoadedMe()) throw new ApiError(0, null);
    const me = await session.loadMe();
    if (!me) {
      rememberMe(null);
      return `/login?${queryString({ returnUrl: url })}`;
    }
    if (!url.startsWith('/consent') && session.takeConsentPrompt()) {
      return `/consent?${queryString({ returnUrl: url })}`;
    }
    if (mode.get() === 'upgrading' && !url.startsWith('/keep-data') && !url.startsWith('/consent')) {
      return '/keep-data';
    }
    return null;
  } catch (error) {
    const unreachable = asApiError(error).status === 0;
    if (unreachable && !recentlyUnreachable) unreachableUntil = Date.now() + unreachableMs;
    const cached = !env.native && unreachable ? (session.me.get() ?? rememberedMe()) : null;
    if (!cached) return `/login?${queryString({ returnUrl: url, reason: 'offline' })}`;
    session.me.set(cached);
    return mode.get() === 'upgrading' && !url.startsWith('/keep-data') ? '/keep-data' : null;
  }
}

/** Guest route guard (sign-up, login, forgot password): null lets the user through; signed in → `/today`. */
export async function guest(session: AuthService = auth): Promise<string | null> {
  const me = await session.loadMe().catch(() => null);
  return me ? '/today' : null;
}
