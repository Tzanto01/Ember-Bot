import { Store, useStore } from './store';

/**
 * One selectable theme (docs/contracts/design-tokens-v1.md); `description` is its description's translation key,
 * `colors` are its `--background` as hex, for `<meta name="theme-color">`, and `notification` tints the Android
 * reminder icon.
 */
export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: { light: string; dark: string };
  notification: string;
}

/** The four themes in picker order; the first is the default. `/theme-init.js` keeps the same ids. */
export const themes = [
  {
    id: 'hearthlight',
    name: 'Hearthlight',
    description: 'themes.hearthlight',
    colors: { light: '#fbf5ec', dark: '#1c1410' },
    notification: '#F69835',
  },
  {
    id: 'fieldnotes',
    name: 'Fieldnotes',
    description: 'themes.fieldnotes',
    colors: { light: '#f6f3e7', dark: '#121914' },
    notification: '#A9D29C',
  },
  {
    id: 'tidepool',
    name: 'Tidepool',
    description: 'themes.tidepool',
    colors: { light: '#eef6f9', dark: '#0a171f' },
    notification: '#7DD5D8',
  },
  {
    id: 'marigold',
    name: 'Marigold',
    description: 'themes.marigold',
    colors: { light: '#fcf6de', dark: '#18130c' },
    notification: '#F6C755',
  },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof themes)[number]['id'];

const storageKey = 'ember.theme';
const accountKey = 'ember.accountTheme';
const schemeKey = 'ember.colorScheme';
const calmKey = 'ember.calm';

/** Light or dark on this device; `system` follows `prefers-color-scheme`. Never synced to the account. */
export type ColorScheme = 'system' | 'light' | 'dark';

/** Bumps whenever `applyTheme` runs, so a mounted picker re-reads `currentTheme()`. */
export const themeApplied = new Store(0);

function find(id: string | undefined) {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}

/** The theme `/theme-init.js` (or the last `applyTheme`) set on `<html>`. */
export function currentTheme(): ThemeId {
  return find(document.documentElement.dataset['theme']).id;
}

/** The current theme's reminder icon tint. */
export function notificationColor(): string {
  return find(currentTheme()).notification;
}

/**
 * Points the light and dark `<meta name="theme-color">` tags at the current theme's background; with a fixed
 * colour scheme both use that scheme's colour.
 */
export function syncThemeColor(): void {
  const { colors } = find(currentTheme());
  const scheme = colorScheme();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const dark = scheme === 'system' ? !!meta.getAttribute('media')?.includes('dark') : scheme === 'dark';
    meta.content = dark ? colors.dark : colors.light;
  }
}

/** Applies a theme now, remembers it on this device for `/theme-init.js`, and updates the theme colour. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset['theme'] = id;
  try {
    localStorage.setItem(storageKey, id);
  } catch {}
  syncThemeColor();
  themeApplied.update((count) => count + 1);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

/** This device's colour scheme, as `/theme-init.js` reads it. */
export function colorScheme(): ColorScheme {
  const scheme = read(schemeKey);
  return scheme === 'light' || scheme === 'dark' ? scheme : 'system';
}

/** Remembers the colour scheme on this device and applies it now. */
export function chooseColorScheme(scheme: ColorScheme): void {
  write(schemeKey, scheme === 'system' ? null : scheme);
  const dark = scheme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : scheme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  syncThemeColor();
}

let picks = 0;

/** How many themes were picked on this device so far; read it before `GET /api/me` for `adoptAccountTheme`. */
export function themePicks(): number {
  return picks;
}

/** Applies a theme the user picked on this device. */
export function chooseTheme(id: ThemeId): void {
  picks++;
  applyTheme(id);
}

/** Records the account's theme as seen by this device, for example after a successful `PATCH /api/me`. */
export function rememberAccountTheme(id: ThemeId | null): void {
  write(accountKey, id);
}

/**
 * Follows the account's theme from a `GET /api/me` that started when `themePicks()` was `picksBefore`. A new account
 * value is applied (null keeps the device as it is); a pick made since the request started wins. Returns the local
 * theme to send to the account when the account still holds the value this device last saw but the local pick
 * differs (an earlier save failed), otherwise null.
 */
export function adoptAccountTheme(account: ThemeId | null, picksBefore: number): ThemeId | null {
  if (picksBefore !== picks) return null;
  if (account !== read(accountKey)) {
    rememberAccountTheme(account);
    if (account && account !== read(storageKey)) applyTheme(account);
    return null;
  }
  const local = themes.find((theme) => theme.id === read(storageKey))?.id;
  return local && local !== account ? local : null;
}

/** Whether calm mode is on (`<html data-calm>`, set by `/theme-init.js` and `applyCalm`). */
export const calmMode = new Store(document.documentElement.dataset['calm'] !== undefined);

/** True while calm mode is on; follows changes live. */
export function useCalmMode(): boolean {
  return useStore(calmMode);
}

/** Turns calm mode on or off now and remembers it on this device for `/theme-init.js`. */
export function applyCalm(on: boolean): void {
  if (on) document.documentElement.dataset['calm'] = '';
  else delete document.documentElement.dataset['calm'];
  write(calmKey, on ? '1' : null);
  calmMode.set(on);
}

/** Forgets this device's theme and the account's and calm mode, and shows the default (for sign-out). */
export function resetTheme(): void {
  write(storageKey, null);
  write(accountKey, null);
  applyCalm(false);
  document.documentElement.dataset['theme'] = themes[0].id;
  syncThemeColor();
  themeApplied.update((count) => count + 1);
}
