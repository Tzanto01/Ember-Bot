import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import type { MergePreview } from '@/lib/models';
import { auth } from '@/lib/services';
import { me, mockFetch } from '@/lib/test-support';
import LinkMergePage from './link-merge';

const preview: MergePreview = {
  habits: 2,
  logs: 5,
  dayMarks: 1,
  habitNames: ['Stretch', 'Read a page'],
  kept: { timezone: 'Europe/Berlin', graceDaysPerWeek: 1 },
};

describe('LinkMergePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  it('lists each habit as one item, then moves everything and lands on Settings', async () => {
    auth.setMe(me);
    const fetch = mockFetch();
    const router = renderPage('/link/merge', LinkMergePage, '/link/merge');
    (await fetch.next('GET', '/api/account/merge')).respond(200, preview);

    const list = await screen.findByRole('list', { name: 'Habits to move' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Stretch', 'Read a page']);
    expect(screen.getByText(/Your settings stay as they are/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Move everything here' }));
    (await fetch.next('POST', '/api/account/merge')).respond(204);
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);
    (await fetch.next('GET', '/api/me')).respond(200, { ...me, discord: { linked: true, id: '1' } });

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.location.search).toBe('?discord=linked');
  });
});
