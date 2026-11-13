import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inGerman, renderPage } from '@/test-utils';
import WhatsNewPage from './whats-new';

describe('WhatsNewPage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('lists every version with its notes, newest first, and marks the newest as seen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          { version: '0.9.0-beta.6', date: '2026-11-14', notes: { en: ['First note.', 'Second note.'] } },
          { version: '0.9.0-beta.5', date: '2026-11-12', notes: { en: ['Older note.'] } },
        ]),
      ),
    );
    renderPage('/whats-new', WhatsNewPage, '/whats-new');

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Ember 0.9.0-beta.6',
      'Ember 0.9.0-beta.5',
    ]);
    const newest = screen.getByRole('region', { name: 'Ember 0.9.0-beta.6' });
    expect(
      within(newest)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['First note.', 'Second note.']);
    expect(within(newest).getByText('November 14, 2026')).toHaveAttribute('datetime', '2026-11-14');
    expect(localStorage.getItem('ember.seenReleaseNotes')).toBe('0.9.0-beta.6');
  });

  it('shows the German notes in German and falls back to English where they are missing', async () => {
    await inGerman();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          { version: '0.9.0-beta.6', date: '2026-11-14', notes: { en: ['New note.'], de: ['Neue Notiz.'] } },
          { version: '0.9.0-beta.5', date: '2026-11-12', notes: { en: ['Older note.'] } },
        ]),
      ),
    );
    renderPage('/whats-new', WhatsNewPage, '/whats-new');

    const notes = (await screen.findAllByRole('listitem')).map((li) => li.textContent);
    expect(notes).toEqual(['Neue Notiz.', 'Older note.']);
  });
});
