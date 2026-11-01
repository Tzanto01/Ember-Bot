/** Moves the app to a local path (path plus query). */
export type NavigateFn = (path: string) => void;

let registered: NavigateFn | null = null;

/** Registers the router's navigate function once at start; null unregisters it. */
export function setNavigator(fn: NavigateFn | null): void {
  registered = fn;
}

/** Navigates to `path` through the registered router, or with a full page load before one is registered. */
export function navigate(path: string): void {
  if (registered) registered(path);
  else window.location.assign(path);
}

/** The current path plus query string, for example `/history?month=2026-10`. */
export function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

/** `key=value` pairs joined with `&`, every key and value URI-encoded; undefined values are left out. */
export function queryString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
