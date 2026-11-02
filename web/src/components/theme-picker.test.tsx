import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemePicker } from './theme-picker';

describe('ThemePicker', () => {
  beforeEach(() => {
    document.documentElement.dataset['theme'] = 'hearthlight';
    document.head.innerHTML =
      '<meta name="theme-color" content="#fbf5ec" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#1c1410" media="(prefers-color-scheme: dark)">';
  });

  afterEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies a picked theme at once, remembers it and updates the theme colour', async () => {
    render(<ThemePicker labelledBy="appearance-heading" />);
    expect(screen.getByRole('radio', { name: 'Hearthlight' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Marigold' }));

    expect(screen.getByRole('radio', { name: 'Marigold' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('marigold');
    expect(localStorage.getItem('ember.theme')).toBe('marigold');
    const colors = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);
    expect(colors).toEqual(['#fcf6de', '#18130c']);
  });

  it('moves and applies with the arrow keys', async () => {
    render(<ThemePicker labelledBy="appearance-heading" />);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Hearthlight' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Fieldnotes' })).toBeChecked());
    await userEvent.keyboard('{/ArrowDown}');
    expect(document.documentElement.dataset['theme']).toBe('fieldnotes');
  });
});
