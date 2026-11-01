import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { themes } from '@/lib/theme';

const source = readFileSync('public/theme-init.js', 'utf8');

function runThemeInit(stored: string | null, dark = false) {
  if (stored === null) localStorage.removeItem('ember.theme');
  else localStorage.setItem('ember.theme', stored);
  vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: () => undefined }));
  new Function(source)();
  return document.documentElement;
}

describe('/theme-init.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  });

  it.each(themes.map((t) => t.id))('keeps the stored theme %s', (id) => {
    expect(runThemeInit(id).dataset['theme']).toBe(id);
  });

  it.each([null, '', 'hearth', 'Marigold', 'toString'])(
    'falls back to hearthlight for %o',
    (stored) => {
      expect(runThemeInit(stored).dataset['theme']).toBe('hearthlight');
    },
  );

  it('sets dark from the colour-scheme preference', () => {
    expect(runThemeInit('tidepool', true).classList.contains('dark')).toBe(true);
    expect(runThemeInit('tidepool', false).classList.contains('dark')).toBe(false);
  });
});
