import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit } from '@/lib/models';
import { auth } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
import HabitEditPage from './habit-edit';

const stretch: Habit = { ...habit, id: 7, name: 'Stretch', reminderTime: '08:00', reminderChannels: ['mobile'] };

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/habits/:id/edit', Component: HabitEditPage },
      { path: '/today', element: <h1>Today</h1> },
    ],
    { initialEntries: ['/habits/7/edit'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function load(fetch: FetchMock, data: Habit = stretch, today = me.localToday) {
  (await fetch.next('GET', '/api/me')).respond(200, { ...me, localToday: today });
  (await fetch.next('GET', '/api/habits/7')).respond(200, data);
  await screen.findByRole('heading', { name: 'Details' });
}

describe('HabitEditPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Discord DM', 'discord'],
    ['Web push', 'webpush'],
  ])('drops mobile when %s is added to a mobile-only habit', async (label, channel) => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    await load(fetch);

    await user.click(screen.getByRole('checkbox', { name: label }));

    const patch = await fetch.next('PATCH', '/api/habits/7');
    expect(patch.body).toEqual({ reminderChannels: [channel] });
    patch.respond(200, { ...stretch, reminderChannels: [channel] });
    expect(await screen.findByText('Reminder channels saved.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
  });

  it('sends nothing when unchanged, then patches only the changed field', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    await load(fetch);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Nothing has changed yet.')).toBeInTheDocument();
    expect(fetch.all.some((call) => call.method === 'PATCH')).toBe(false);

    const name = screen.getByLabelText('Name', { exact: true });
    await user.clear(name);
    await user.type(name, 'Stretch longer');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const patch = await fetch.next('PATCH', '/api/habits/7');
    expect(patch.body).toEqual({ name: 'Stretch longer' });
    patch.respond(200, { ...stretch, name: 'Stretch longer' });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('cancels the delete confirm with Escape, but ignores Escape while the delete is in flight', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    const router = renderPage();
    await load(fetch);

    await user.click(screen.getByRole('button', { name: 'Delete habit' }));
    expect(screen.getByRole('group', { name: /Delete Stretch and all its check-ins/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /Delete Stretch/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete habit' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Delete habit' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    const remove = await fetch.next('DELETE', '/api/habits/7');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('group', { name: /Delete Stretch/ })).toBeInTheDocument();

    remove.respond(204);
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
  });

  it('reloads me on entry, so a pause cannot end before the fresh local today', async () => {
    auth.setMe({ ...me, localToday: '2026-10-31' });
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    await load(fetch, stretch, '2026-11-01');

    fireEvent.change(screen.getByLabelText('Pause until'), { target: { value: '2026-10-31' } });
    await user.click(screen.getByRole('button', { name: 'Pause habit' }));

    expect(screen.getByText('Pick today or a later day.')).toBeInTheDocument();
    expect(fetch.all.some((call) => call.url === '/api/habits/7/pause')).toBe(false);
  });
});
