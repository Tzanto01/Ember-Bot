/** Build-time settings for the web (PWA) build: same-origin API, cookie auth. */
export const environment = {
  native: false,
  /** Prefix for `/api` calls; empty means same origin (relative URLs). */
  apiBase: '',
  /** Where browser-only flows (Discord, sign-up links) live. Empty means this origin. */
  webOrigin: '',
};
