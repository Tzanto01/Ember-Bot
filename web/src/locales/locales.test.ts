import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';

const english = en as Record<string, string>;
const german = de as Record<string, string>;
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]!))].sort();
const tags = (text: string) => [...new Set([...text.matchAll(/<\/?\s*(\w+)[^>]*>/g)].map((m) => m[1]!))].sort();

describe('en.json and de.json', () => {
  it('have exactly the same keys', () => {
    const enKeys = Object.keys(english);
    const deKeys = Object.keys(german);
    expect(deKeys.filter((key) => !(key in english))).toEqual([]);
    expect(enKeys.filter((key) => !(key in german))).toEqual([]);
  });

  it('have no empty German value', () => {
    expect(Object.entries(german).filter(([, value]) => typeof value !== 'string' || value.trim() === '').map(([key]) => key)).toEqual([]);
  });

  it('use the same interpolation placeholders and Trans tags in both languages', () => {
    const mismatched = Object.keys(english).filter(
      (key) =>
        key in german &&
        (placeholders(english[key]!).join() !== placeholders(german[key]!).join() ||
          tags(english[key]!).join() !== tags(german[key]!).join()),
    );
    expect(mismatched).toEqual([]);
  });

  it('keep dashes out of the German text (no em dash, en dash or spaced hyphen)', () => {
    expect(Object.entries(german).filter(([, value]) => /[–—]| - /.test(value)).map(([key]) => key)).toEqual([]);
  });

  it.each([
    ['en', english],
    ['de', german],
  ])('give every %s _one plural its _other sibling', (_language, file) => {
    const missing = Object.keys(file)
      .filter((key) => key.endsWith('_one'))
      .filter((key) => !(`${key.slice(0, -4)}_other` in file));
    expect(missing).toEqual([]);
  });
});
