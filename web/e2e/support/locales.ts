import { readFileSync } from 'node:fs';

function load(file: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../src/locales/${file}.json`, import.meta.url), 'utf8'));
}

export const languages = [
  { code: 'en', locale: 'en-US', strings: load('en') },
  { code: 'de', locale: 'de-DE', strings: load('de') },
] as const;

export type LanguageCode = (typeof languages)[number]['code'];

/** Returns the translator for one language: `tr('key', { name })` fills `{{name}}` like the app does. */
export function translator(strings: Record<string, string>) {
  return (key: string, values: Record<string, string> = {}): string =>
    (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');
}
