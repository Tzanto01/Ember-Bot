import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitTemplate } from '@/lib/models';
import { localMode } from '@/lib/services';
import { habit, mockFetch } from '@/lib/test-support';
import HabitNewPage from './habit-new';

vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return { ...(await original<typeof import('@/lib/services')>()), localMode: { mode: new Store('account') } };
});

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

  afterEach(() => {
    vi.unstubAllGlobals();
    localMode.mode.set('account');
  });

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
  it('creates a habit on set weekdays several times a day', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

    await user.type(await screen.findByLabelText('Name', { exact: true }), 'Water');
    await user.click(screen.getByRole('radio', { name: 'On set days' }));
    await user.click(screen.getByRole('checkbox', { name: 'Friday' }));
    await user.selectOptions(screen.getByLabelText('Times a day'), '3');
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect((await fetch.next('POST', '/api/habits')).body).toEqual({
      name: 'Water',
      frequency: 'weekdays',
      days: ['mon', 'tue', 'wed', 'thu'],
      timesPerDay: 3,
    });
  });

  it('asks for at least one day before sending anything', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

    await user.type(await screen.findByLabelText('Name', { exact: true }), 'Water');
    await user.click(screen.getByRole('radio', { name: 'On set days' }));
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await user.click(screen.getByRole('checkbox', { name: day }));
    }
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect(screen.getByText('Pick at least one day.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toHaveFocus();
    expect(fetch.all.some((call) => call.method === 'POST')).toBe(false);
  });

  it('saves all seven days as every day and shows server field messages', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

    await user.type(await screen.findByLabelText('Name', { exact: true }), 'Water');
    await user.click(screen.getByRole('radio', { name: 'On set days' }));
    await user.click(screen.getByRole('checkbox', { name: 'Saturday' }));
    await user.click(screen.getByRole('checkbox', { name: 'Sunday' }));
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    const create = await fetch.next('POST', '/api/habits');
    expect(create.body).toEqual({ name: 'Water', frequency: 'daily', timesPerDay: 1 });
    create.respond(400, { type: 'validation', errors: { timesPerDay: ['Choose 1 to 10 times a day.'] } });
    expect(await screen.findByText('Choose 1 to 10 times a day.')).toBeInTheDocument();
  });

  it('sends one habit when the form is submitted twice in the same moment', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, [template]);

    await user.click(await screen.findByRole('button', { name: 'Start from scratch' }));
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Stretch');
    const form = screen.getByRole('button', { name: 'Create habit' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await fetch.next('POST', '/api/habits');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch.all.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('says how reminders can reach an account that has no channel yet', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, [template]);

    await user.click(await screen.findByRole('button', { name: /Walk/ }));

    expect(await screen.findByText(/Reminders reach you through Discord or notifications on this device/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn one on in Settings.' })).toHaveAttribute('href', '/settings#push');
  });

  it('offers no reminder time without an account on the web', async () => {
    localMode.mode.set('local');
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, [template]);

    const card = await screen.findByRole('button', { name: /Walk/ });
    expect(card).not.toHaveTextContent('reminder at');
    await user.click(card);
    expect(screen.queryByLabelText(/Reminder time/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create habit' }));

    expect((await fetch.next('POST', '/api/habits')).body).toEqual({ name: 'Walk', frequency: 'daily', timesPerDay: 1 });
  });
});
