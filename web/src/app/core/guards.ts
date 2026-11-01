import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Lets signed-in users through (loads `me` once). Signed out → `/login?returnUrl=…`;
 * API unreachable → the same with `reason=offline`. Offers the consent step once per app session
 * when consent is missing, which also covers the return from Discord sign-in.
 */
export const signedInGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const me = await auth.loadMe();
    if (!me) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    if (!state.url.startsWith('/consent') && auth.takeConsentPrompt()) {
      return router.createUrlTree(['/consent'], { queryParams: { returnUrl: state.url } });
    }
    return true;
  } catch {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url, reason: 'offline' } });
  }
};

/** Keeps signed-in users away from sign-up, login and forgot-password (sends them to `/today`). */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const me = await auth.loadMe().catch(() => null);
  return me ? router.createUrlTree(['/today']) : true;
};
