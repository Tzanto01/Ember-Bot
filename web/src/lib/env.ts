/** Build-time settings. Web: same-origin API with cookie auth. Mobile (`--mode mobile`, `.env.mobile`): bearer auth. */
export const env = {
  /** True in the Capacitor build. */
  native: import.meta.env.VITE_NATIVE === 'true',
  /** Prefix for `/api` calls; empty means same origin (relative URLs). */
  apiBase: import.meta.env.VITE_API_BASE ?? '',
  /** Where browser-only flows (Discord, sign-up links) live. Empty means this origin. */
  webOrigin: import.meta.env.VITE_WEB_ORIGIN ?? '',
};
