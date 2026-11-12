import { afterEach, describe, expect, it } from 'vitest';
import { installId, phoneLabel } from './phone';

describe('phoneLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.004; wv) AppleWebKit/537.36',
      'Pixel 8',
    ],
    ['Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36', 'SM-S918B'],
    ['Mozilla/5.0 (Linux; U; Android 4.4.2; Nexus 5; de-de) AppleWebKit/534.30', 'Nexus 5'],
  ])('reads the model from %s', (userAgent, label) => {
    expect(phoneLabel(userAgent)).toBe(label);
  });

  it.each([
    ['a reduced user agent', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'],
    ['no Android token', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0'],
    ['an empty model', 'Mozilla/5.0 (Linux; Android 14; ) AppleWebKit/537.36'],
    ['a bidi control in the model', 'Mozilla/5.0 (Linux; Android 14; Pix‮el) AppleWebKit/537.36'],
    ['a line separator in the model', 'Mozilla/5.0 (Linux; Android 14; Pix\u2028el) AppleWebKit/537.36'],
    ['a paragraph separator in the model', 'Mozilla/5.0 (Linux; Android 14; Pix\u2029el) AppleWebKit/537.36'],
    ['a lone surrogate in the model', 'Mozilla/5.0 (Linux; Android 14; Pix\ud83del) AppleWebKit/537.36'],
    ['a surrogate pair cut at 60 characters', `Mozilla/5.0 (Linux; Android 14; ${'X'.repeat(59)}\u{1F600})`],
  ])('says "Android phone" for %s', (_name, userAgent) => {
    expect(phoneLabel(userAgent)).toBe('Android phone');
  });

  it('keeps at most 60 characters', () => {
    expect(phoneLabel(`Mozilla/5.0 (Linux; Android 14; ${'X'.repeat(80)})`)).toBe('X'.repeat(60));
  });
});

describe('installId', () => {
  afterEach(() => localStorage.clear());

  it('makes one id the server accepts and keeps it across calls', () => {
    const id = installId();

    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(installId()).toBe(id);
  });

  it('replaces a stored value the server would refuse', () => {
    localStorage.setItem('ember.installId', 'bad id!');

    expect(installId()).not.toBe('bad id!');
    expect(localStorage.getItem('ember.installId')).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});
