import { registerSW } from 'virtual:pwa-register';
import type { DeviceStore } from './device-store';
import { env } from './env';
import { deviceToday, rememberMe } from './guards';
import type { OfflineCache } from './http';
import type { Habit, Me } from './models';
import { auth, deviceStore, deviceSync, http, localMode, push } from './services';
import { Store } from './store';

const preloadReloadKey = 'ember.preloadReload';

/** Set when a new version of the app is installed and waiting; calling it activates that version and reloads. */
export const updateReady = new Store<(() => void) | null>(null);

/**
 * The habit list (`GET /api/habits`) kept per user in the device store, served offline only while its days are still
 * today on this device, so a list from another day never shows as current.
 */
export function habitsCache(store: Pick<DeviceStore, 'habits' | 'saveHabits'>, me: () => Me | null): OfflineCache {
  return {
    save(url, body) {
      const user = me();
      if (url !== '/api/habits' || !user || !Array.isArray(body)) return;
      void store.saveHabits({ userId: user.id, timeZone: user.timezone, habits: body as Habit[] }).catch(() => undefined);
    },
    async load(url) {
      const user = me();
      if (url !== '/api/habits' || !user) return undefined;
      const cached = await store.habits(user.id);
      if (!cached) return undefined;
      const today = deviceToday(cached.timeZone);
      return today && cached.habits.every((habit) => habit.today.date === today) ? cached.habits : undefined;
    },
  };
}

function registerServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => updateReady.set(() => void updateSW(true)),
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    },
  });
}

/**
 * App start, called once by `main.tsx` before the first render: restores no-account mode, asks for the antiforgery
 * token without waiting for it (web, not in no-account mode; `Http` refreshes and retries on a 403 `antiforgery`),
 * starts the device sync, and on the web keeps `me` and the habit list on the device for an offline cold start,
 * registers the service worker once the page has loaded (offering a reload when a new version waits), reloads (at most once a
 * minute) when a lazy chunk of a replaced version fails to load, and re-claims this browser's push subscription for whoever
 * signs in to an account. Never throws.
 */
export async function startApp(): Promise<void> {
  await localMode.init();
  if (localMode.mode.get() !== 'local') void auth.refreshAntiforgery();
  deviceSync.start();
  if (env.native) return;
  http.offlineCache = habitsCache(deviceStore, () => auth.me.get());
  auth.me.subscribe(() => {
    if (localMode.mode.get() !== 'local') rememberMe(auth.me.get());
  });
  window.addEventListener('vite:preloadError', (event) => {
    if (Date.now() - Number(sessionStorage.getItem(preloadReloadKey) ?? 0) < 60_000) return;
    sessionStorage.setItem(preloadReloadKey, String(Date.now()));
    event.preventDefault();
    location.reload();
  });
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
  let claimedFor: string | null = null;
  const claim = () => {
    const id = auth.me.get()?.id ?? null;
    if (id && id !== claimedFor && localMode.mode.get() !== 'local') void push.claim();
    claimedFor = id;
  };
  auth.me.subscribe(claim);
  claim();
}
