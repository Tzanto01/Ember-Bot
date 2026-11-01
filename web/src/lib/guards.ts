import type { AuthService } from './auth';
import { queryString } from './navigation';
import { auth } from './services';

/**
 * Signed-in route guard for `url` (path plus query): null lets the user through (loads `me` once).
 * Signed out → `/login?returnUrl=…`; API unreachable → the same with `reason=offline`. Offers the consent step
 * once per app session when consent is missing, which also covers the return from Discord sign-in.
 */
export async function signedIn(url: string, session: AuthService = auth): Promise<string | null> {
  try {
    const me = await session.loadMe();
    if (!me) return `/login?${queryString({ returnUrl: url })}`;
    if (!url.startsWith('/consent') && session.takeConsentPrompt()) {
      return `/consent?${queryString({ returnUrl: url })}`;
    }
    return null;
  } catch {
    return `/login?${queryString({ returnUrl: url, reason: 'offline' })}`;
  }
}

/** Guest route guard (sign-up, login, forgot password): null lets the user through; signed in → `/today`. */
export async function guest(session: AuthService = auth): Promise<string | null> {
  const me = await session.loadMe().catch(() => null);
  return me ? '/today' : null;
}
