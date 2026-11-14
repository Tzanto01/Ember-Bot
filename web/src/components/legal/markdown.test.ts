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

  it('leaves out the leading English summary and the rule after it only when asked', () => {
    const source =
      '# Impressum\n\n> **English summary (not binding).** Legal notice.\n\n---\n\n**Stand:** heute\n\n> Ein Zitat\n';
    const shown = new DOMParser().parseFromString(renderLegal(source).html, 'text/html');
    expect(shown.querySelector('blockquote[lang="en"]')?.textContent).toContain('Legal notice.');
    expect(shown.querySelectorAll('hr')).toHaveLength(1);

    const hidden = new DOMParser().parseFromString(renderLegal(source, true).html, 'text/html');
    expect(hidden.body.textContent).not.toContain('English summary');
    expect(hidden.querySelectorAll('hr')).toHaveLength(0);
    expect(hidden.body.firstElementChild?.textContent).toBe('Stand: heute');
    expect(hidden.querySelectorAll('blockquote')).toHaveLength(1);
  });

  it('keeps a rule that does not follow a hidden summary', () => {
    const { html } = renderLegal('# Impressum\n\nText\n\n---\n\nMehr\n', true);
    expect(html).toContain('<hr');
  });
});
