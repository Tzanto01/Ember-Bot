import { Store } from './store';

/** One selectable theme (docs/contracts/design-tokens-v1.md); `colors` are its `--background` as hex, for `<meta name="theme-color">`. */
export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: { light: string; dark: string };
}

/** The four themes in picker order; the first is the default. `/theme-init.js` keeps the same ids. */
export const themes = [
  {
    id: 'hearthlight',
    name: 'Hearthlight',
    description: 'Candle-lit kitchen table: warm, soft, familiar.',
    colors: { light: '#fbf5ec', dark: '#1c1410' },
  },
  {
    id: 'fieldnotes',
    name: 'Fieldnotes',
    description: 'Pocket notebook: grounded, quiet, literary.',
    colors: { light: '#f6f3e7', dark: '#121914' },
  },
  {
    id: 'tidepool',
    name: 'Tidepool',
    description: 'Morning by the water: cool, airy, unhurried.',
    colors: { light: '#eef6f9', dark: '#0a171f' },
  },
  {
    id: 'marigold',
    name: 'Marigold',
    description: 'Sticker sheet: playful, confident, high contrast.',
    colors: { light: '#fcf6de', dark: '#18130c' },
  },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof themes)[number]['id'];

const storageKey = 'ember.theme';

/** Bumps whenever `applyTheme` runs, so a mounted picker re-reads `currentTheme()`. */
export const themeApplied = new Store(0);

function find(id: string | undefined) {
  return themes.find((theme) => theme.id === id) ?? themes[0];
}

/** The theme `/theme-init.js` (or the last `applyTheme`) set on `<html>`. */
export function currentTheme(): ThemeId {
  return find(document.documentElement.dataset['theme']).id;
}

/** Points the light and dark `<meta name="theme-color">` tags at the current theme's background. */
export function syncThemeColor(): void {
  const { colors } = find(currentTheme());
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = meta.getAttribute('media')?.includes('dark') ? colors.dark : colors.light;
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

/** Applies the account's theme from `/api/me` when it differs from this device's copy; null leaves the device as it is. */
export function adoptAccountTheme(id: ThemeId | null): void {
  let copy: string | null = null;
  try {
    copy = localStorage.getItem(storageKey);
  } catch {}
  if (id && id !== copy) applyTheme(id);
}
