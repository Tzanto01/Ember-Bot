import { describe, expect, it } from 'vitest';
import { renderLegal } from './markdown';

describe('renderLegal', () => {
  it('labels each table cell with its column heading so narrow screens can stack rows', () => {
    const { html } = renderLegal('| Wo | Name |\n| --- | --- |\n| Browser | `ember.mode` |\n');
    const table = new DOMParser().parseFromString(html, 'text/html');
    const cells = [...table.querySelectorAll('tbody td')].map((td) => [
      td.getAttribute('data-label'),
      td.innerHTML,
    ]);
    expect(cells).toEqual([
      ['Wo', 'Browser'],
      ['Name', '<code>ember.mode</code>'],
    ]);
    expect(table.querySelectorAll('thead th')).toHaveLength(2);
  });

  it('escapes a heading that carries markup into the label', () => {
    const { html } = renderLegal('| a"<b> | x |\n| --- | --- |\n| 1 | 2 |\n');
    expect(html).toContain('data-label="a&quot;&lt;b&gt;"');
  });

  it('marks only the English summary quote as English and still escapes markup in it', () => {
    const { html } = renderLegal('> **English summary** <img src=x onerror=alert(1)>\n\n> Ein Zitat\n');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const quotes = [...doc.querySelectorAll('blockquote')];
    expect(quotes.map((quote) => quote.getAttribute('lang'))).toEqual(['en', null]);
    expect(doc.querySelector('img')).toBeNull();
  });
});
