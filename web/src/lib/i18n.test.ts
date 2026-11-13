import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLanguage, currentLanguage, de, deviceLanguage } from './i18n';

function browserLanguages(languages: string[]) {
  vi.stubGlobal('navigator', { languages, language: languages[0] });
}

describe('deviceLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([
    [['de-DE'], 'de'],
    [['fr-FR', 'de-AT'], 'de'],
    [['fr-FR', 'en-GB', 'de-DE'], 'en'],
    [['fr-FR'], 'en'],
  ])('picks the first English or German browser language from %j: %s', (tags, expected) => {
    browserLanguages(tags);
    expect(deviceLanguage()).toBe(expected);
  });

  it('prefers the language stored on this device over the browser language', () => {
    browserLanguages(['de-DE']);
    localStorage.setItem('ember.language', 'en');
    expect(deviceLanguage()).toBe('en');
  });

  it('ignores a stored value that is not a supported language', () => {
    browserLanguages(['de-DE']);
    localStorage.setItem('ember.language', 'fr');
    expect(deviceLanguage()).toBe('de');
  });
});

describe('applyLanguage', () => {
  afterEach(() => document.head.querySelector('meta[name="description"]')?.remove());

  it('sets <html lang> and the meta description to the German pitch description', () => {
    const meta = document.createElement('meta');
    meta.name = 'description';
    meta.content = 'A calm companion for hard moments and gentle days.';
    document.head.append(meta);

    applyLanguage('de');

    expect(currentLanguage()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(meta.content).toBe(de['pitch.description']);
  });
});
