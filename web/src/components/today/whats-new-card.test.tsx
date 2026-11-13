import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { WhatsNewCard } from './whats-new-card';

const seenKey = 'ember.seenReleaseNotes';
const notes = [
  { version: '0.9.0-beta.6', date: '2026-11-14', notes: { en: ['Something new.'] } },
  { version: '0.9.0-beta.5', date: '2026-11-12', notes: { en: ['Something older.'] } },
];

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

function renderCard() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(notes)),
  );
  return renderPage('/today', WhatsNewCard, '/today');
}

describe('WhatsNewCard', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays hidden on the very first visit and records the current version', async () => {
    renderCard();

    await settle();
    expect(localStorage.getItem(seenKey)).toBe('0.9.0-beta.6');
    expect(screen.queryByText(/is here/)).toBeNull();
  });

  it('shows once after an update and links to What new', async () => {
    localStorage.setItem(seenKey, '0.9.0-beta.5');
    const router = renderCard();

    expect(await screen.findByText('Ember 0.9.0-beta.6 is here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: "See what's new" }));
    expect(router.state.location.pathname).toBe('/whats-new');
  });

  it('records the version when dismissed and hides', async () => {
    localStorage.setItem(seenKey, '0.9.0-beta.5');
    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/is here/)).toBeNull();
    expect(localStorage.getItem(seenKey)).toBe('0.9.0-beta.6');
  });

  it('stays hidden for a version already seen', async () => {
    localStorage.setItem(seenKey, '0.9.0-beta.6');
    renderCard();

    await settle();
    expect(screen.queryByText(/is here/)).toBeNull();
  });

  it('stays hidden when storage fails', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderCard();

    await settle();
    expect(screen.queryByText(/is here/)).toBeNull();
  });
});
