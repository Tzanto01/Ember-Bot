import { registerSW } from 'virtual:pwa-register';
import { env } from './env';
import { auth, deviceSync, push } from './services';

/**
 * App start, called once by `main.tsx` before the first render: fetches the antiforgery token (web), starts the
 * device sync, and on the web registers the service worker and re-claims this browser's push subscription for
 * whoever signs in. Never throws.
 */
export async function startApp(): Promise<void> {
  await auth.refreshAntiforgery();
  deviceSync.start();
  if (env.native) return;
  registerSW({ immediate: true });
  let claimedFor: string | null = null;
  const claim = () => {
    const id = auth.me.get()?.id ?? null;
    if (id && id !== claimedFor) void push.claim();
    claimedFor = id;
  };
  auth.me.subscribe(claim);
  claim();
}
