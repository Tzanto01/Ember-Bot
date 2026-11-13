import i18next, { type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import coreDe from '@/locales/parts/core.de.json';
import coreEn from '@/locales/parts/core.en.json';
import historyDe from '@/locales/parts/history.de.json';
import historyEn from '@/locales/parts/history.en.json';
import momentDe from '@/locales/parts/moment.de.json';
import momentEn from '@/locales/parts/moment.en.json';
import publicDe from '@/locales/parts/public.de.json';
import publicEn from '@/locales/parts/public.en.json';
import settingsDe from '@/locales/parts/settings.de.json';
import settingsEn from '@/locales/parts/settings.en.json';
import todayDe from '@/locales/parts/today.de.json';
import todayEn from '@/locales/parts/today.en.json';

/** The languages Ember shows (docs/contracts/i18n-v1.md). */
export type Language = 'en' | 'de';

export const languages: readonly Language[] = ['en', 'de'];

export const en = { ...coreEn, ...momentEn, ...publicEn, ...todayEn, ...historyEn, ...settingsEn };
export const de = { ...coreDe, ...momentDe, ...publicDe, ...todayDe, ...historyDe, ...settingsDe };

const deviceKey = 'ember.language';

/** True for `en` and `de`. */
export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'de';
}

/** A locale tag starting with `de` maps to `de`; everything else to `en`. */
export function toLanguage(tag: string | null | undefined): Language {
  return tag && /^de(?:[-_]|$)/i.test(tag) ? 'de' : 'en';
}

/** The language picked on this device, or null when none is stored (or storage fails). */
export function storedLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(deviceKey);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Remembers the language picked on this device (`ember.language`); a failing storage is ignored. */
export function rememberDeviceLanguage(language: Language): void {
  try {
    localStorage.setItem(deviceKey, language);
  } catch {}
}

/** The device's language: the stored pick, else the first English or German entry of `navigator.languages`, else `en`. */
export function deviceLanguage(): Language {
  const stored = storedLanguage();
  if (stored) return stored;
  const tags =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return toLanguage(tags.find((tag) => /^(?:de|en)(?:[-_]|$)/i.test(tag ?? '')));
}

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  supportedLngs: languages,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

/** Translates outside React components; call it when the text is shown, never at module load. */
export const t: TFunction = i18next.t.bind(i18next) as TFunction;

/** The language shown now. */
export function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : 'en';
}

/** Shows `language` now: the strings, `<html lang>` and the document's meta description. */
export function applyLanguage(language: Language): void {
  if (i18next.language !== language) void i18next.changeLanguage(language);
  document.documentElement.lang = language;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', t('pitch.description'));
}

/** Calls `listener` after every language change; returns the unsubscribe function. */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  const handler = (language: string) => listener(isLanguage(language) ? language : 'en');
  i18next.on('languageChanged', handler);
  return () => i18next.off('languageChanged', handler);
}

export default i18next;
