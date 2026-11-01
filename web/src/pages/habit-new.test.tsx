import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitTemplate } from '@/lib/models';
import { habit, mockFetch } from '@/lib/test-support';
import HabitNewPage from './habit-new';

const template: HabitTemplate = {
  key: 'walk',
  name: 'Walk',
  description: 'A short walk outside.',
  suggestedReminderTime: '08:00',
  frequency: 'daily',
  weeklyTarget: null,
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/habits/new', Component: HabitNewPage },
      { path: '/today', element: <h1>Today</h1> },
    ],
    { initialEntries: ['/habits/new'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('HabitNewPage', () => {
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

  it('creates a habit from scratch with the trimmed name and weekly target, then lands on /today', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    const router = renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, [template]);

    await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
    const name = screen.getByLabelText('Name', { exact: true });
    expect(name).toHaveFocus();
    await user.type(name, '  Stretch  ');
    await user.click(screen.getByRole('radio', { name: 'A few times a week' }));
    await user.selectOptions(screen.getByLabelText('Times per week'), '4');
    fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: '07:30' } });
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    const create = await fetch.next('POST', '/api/habits');
    expect(create.body).toEqual({ name: 'Stretch', frequency: 'weekly', weeklyTarget: 4, reminderTime: '07:30' });
    create.respond(201, { ...habit, name: 'Stretch' });

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
  });

  it('skips to the form when suggestions fail to load, and asks for a name before sending anything', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(500);

    const name = await screen.findByLabelText('Name', { exact: true });
    expect(screen.queryByRole('button', { name: 'Back to suggestions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect(screen.getByText('Give your habit a short name.')).toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(fetch.all.some((call) => call.method === 'POST')).toBe(false);
  });
});
