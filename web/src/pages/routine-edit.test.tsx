import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Habit } from '@/lib/models';
import { type FetchMock, habit, mockFetch } from '@/lib/test-support';
import RoutineEditPage from './routine-edit';

const water: Habit = { ...habit, id: 3, name: 'Water' };

function renderNew() {
  const router = createMemoryRouter(
    [
      { path: '/routines/new', Component: RoutineEditPage },
      { path: '/routines', element: <h1>Routines</h1> },
    ],
    { initialEntries: ['/routines/new'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function load(f: FetchMock) {
  (await f.next('GET', '/api/routines')).respond(200, []);
  (await f.next('GET', '/api/habits')).respond(200, [habit, water]);
  await screen.findByRole('heading', { name: 'Details' });
}

describe('RoutineEditPage (new)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a routine with its habits in the chosen order, then lands on /routines', async () => {
    const user = userEvent.setup();
    const f = mockFetch();
    const router = renderNew();
    await load(f);

    await user.type(screen.getByLabelText('Name', { exact: true }), '  Morning ');
    await user.click(screen.getByRole('button', { name: 'Add Walk' }));
    await user.click(screen.getByRole('button', { name: 'Add Water' }));
    const up = screen.getByRole('button', { name: 'Move Water up' });
    await user.click(up);
    expect(up).toHaveFocus();
    expect(await screen.findByText('Water moved to 1 of 2.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: '07:30' } });
    await user.click(screen.getByRole('button', { name: 'Create routine' }));

    const create = await f.next('POST', '/api/routines');
    expect(create.body).toEqual({ name: 'Morning', habitIds: [3, 1], reminderTime: '07:30' });
    create.respond(201, { id: 1, name: 'Morning', reminderTime: '07:30', reminderChannels: [], habitIds: [3, 1] });
    expect(await screen.findByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/routines');
  });

  it('says gently when the routine limit is reached', async () => {
    const user = userEvent.setup();
    const f = mockFetch();
    renderNew();
    await load(f);

    await user.type(screen.getByLabelText('Name', { exact: true }), 'Evening');
    await user.click(screen.getByRole('button', { name: 'Create routine' }));
    (await f.next('POST', '/api/routines')).respond(409, { type: 'conflict', detail: 'Limit reached.' });

    expect(
      await screen.findByText('You have 10 routines, the most Ember keeps. Remove one you no longer need to make room.'),
    ).toBeInTheDocument();
  });
});
