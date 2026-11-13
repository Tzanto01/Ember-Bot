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
});
