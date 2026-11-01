import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it.each(['/today', '/history?x=1'])('keeps the local path %s', (url) => {
    expect(safeReturnUrl(url)).toBe(url);
  });

  it.each(['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'today', '', null, undefined])(
    'falls back for %s',
    (url) => {
      expect(safeReturnUrl(url)).toBe('/today');
    },
  );

  it('uses the given fallback', () => {
    expect(safeReturnUrl('//evil.com', '/home')).toBe('/home');
  });
});
