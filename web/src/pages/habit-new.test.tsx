import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HabitTemplate } from '@/lib/models';
import { auth, localMode, push } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
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
    vi.restoreAllMocks();
    localMode.mode.set('account');
    auth.me.set(null);
    push.available.set(false);
    push.subscribed.set(false);
  });

  describe('reminder times', () => {
    async function threeTimes(user: ReturnType<typeof userEvent.setup>, fetch: FetchMock) {
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);
      await user.type(await screen.findByLabelText('Name', { exact: true }), 'Water');
      await user.selectOptions(screen.getByLabelText('Times a day'), '3');
      fireEvent.change(screen.getByLabelText('Reminder time 1'), { target: { value: '20:00' } });
      await user.click(screen.getByRole('button', { name: 'Add another time' }));
      fireEvent.change(screen.getByLabelText('Reminder time 2'), { target: { value: '08:00' } });
      await user.click(screen.getByRole('button', { name: 'Add another time' }));
      fireEvent.change(screen.getByLabelText('Reminder time 3'), { target: { value: '13:00' } });
    }

    it('offers a time per check-in, focuses each new one and spells out the schedule', async () => {
      const user = userEvent.setup();
      const fetch = mockFetch();
      renderPage();
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

      await user.type(await screen.findByLabelText('Name', { exact: true }), 'Water');
      expect(screen.queryByRole('button', { name: 'Add another time' })).toBeNull();
      await user.selectOptions(screen.getByLabelText('Times a day'), '3');
      const group = screen.getByRole('group', { name: 'Reminder times (optional)' });
      fireEvent.change(screen.getByLabelText('Reminder time 1'), { target: { value: '20:00' } });
      expect(group).toHaveAccessibleDescription(/Ember reminds you once, at 20:00/);
      await user.click(screen.getByRole('button', { name: 'Add another time' }));
      expect(screen.getByLabelText('Reminder time 2')).toHaveFocus();
      fireEvent.change(screen.getByLabelText('Reminder time 2'), { target: { value: '08:00' } });
      await user.click(screen.getByRole('button', { name: 'Add another time' }));
      fireEvent.change(screen.getByLabelText('Reminder time 3'), { target: { value: '13:00' } });

      expect(screen.queryByRole('button', { name: 'Add another time' })).toBeNull();
      expect(group).toHaveAccessibleDescription(
        /Ember reminds you at 08:00, 13:00 and 20:00 until you've checked in 3 times\./,
      );
    });

    it('removes a time, drops the latest when check-ins go down, and sends the times sorted', async () => {
      const user = userEvent.setup();
      const fetch = mockFetch();
      renderPage();
      await threeTimes(user, fetch);

      await user.click(screen.getByRole('button', { name: 'Remove 13:00' }));
      expect(screen.getByLabelText('Reminder time 2')).toHaveFocus();
      expect(screen.queryByLabelText('Reminder time 3')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Add another time' }));
      fireEvent.change(screen.getByLabelText('Reminder time 3'), { target: { value: '13:00' } });

      await user.selectOptions(screen.getByLabelText('Times a day'), '2');
      expect(screen.getAllByText('20:00 was taken off, since you now check in 2 times a day.')).toHaveLength(2);
      expect(screen.getByLabelText('Reminder time 1')).toHaveValue('08:00');
      expect(screen.getByLabelText('Reminder time 2')).toHaveValue('13:00');
      await user.click(screen.getByRole('button', { name: 'Create habit' }));

      expect((await fetch.next('POST', '/api/habits')).body).toEqual({
        name: 'Water',
        frequency: 'daily',
        timesPerDay: 2,
        reminderTimes: ['08:00', '13:00'],
      });
    });
  });

  describe('how a habit reminds you', () => {
    beforeEach(() => {
      auth.setMe({ ...me, discord: { linked: true, id: '1' } });
      push.available.set(true);
      vi.spyOn(push, 'check').mockResolvedValue();
    });

    async function createWith(fetch: FetchMock, name: string, time: string, untick: string[] = [], tick: string[] = []) {
      await user().type(await screen.findByLabelText('Name', { exact: true }), name);
      fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: time } });
      for (const label of untick) await user().click(screen.getByRole('checkbox', { name: label }));
      for (const label of tick) await user().click(screen.getByRole('checkbox', { name: label }));
      await user().click(screen.getByRole('button', { name: 'Create habit' }));
      return fetch.next('POST', '/api/habits');
    }
    let current: ReturnType<typeof userEvent.setup>;
    const user = () => current;
    beforeEach(() => {
      current = userEvent.setup();
    });

    it('asks this browser for notifications on the first device reminder, not again once subscribed, and keeps each choice', async () => {
      const subscribe = vi.spyOn(push, 'subscribe').mockImplementation(async () => push.subscribed.set(true));
      const fetch = mockFetch();
      const router = renderPage();
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

      const first = await createWith(fetch, 'Water', '08:00');
      expect(first.body).toMatchObject({ reminderTimes: ['08:00'], reminderChannels: ['webpush'] });
      expect(subscribe).toHaveBeenCalledTimes(1);
      first.respond(201, { ...habit, name: 'Water' });
      expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();

      await router.navigate('/habits/new');
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);
      expect(screen.getByRole('checkbox', { name: 'Notifications on this device' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Discord DM' })).not.toBeChecked();
      const second = await createWith(fetch, 'Read', '21:00', ['Notifications on this device'], ['Discord DM']);
      expect(second.body).toMatchObject({ reminderTimes: ['21:00'], reminderChannels: ['discord'] });
      second.respond(201, { ...habit, id: 2, name: 'Read' });
      expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();

      await router.navigate('/habits/new');
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);
      const third = await createWith(fetch, 'Stretch', '07:00');
      expect(third.body).toMatchObject({ reminderChannels: ['webpush'] });
      expect(subscribe).toHaveBeenCalledTimes(1);
    });

    it('keeps the choice when the browser blocks notifications, and says where to turn them on', async () => {
      vi.spyOn(push, 'subscribe').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      const fetch = mockFetch();
      const router = renderPage();
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

      const create = await createWith(fetch, 'Water', '08:00');
      expect(create.body).toMatchObject({ reminderTimes: ['08:00'], reminderChannels: ['webpush'] });
      create.respond(201, { ...habit, name: 'Water', reminderChannels: ['webpush'] });

      expect(await screen.findByText(/Notifications are off for Ember in this browser/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Turn them on in Settings' })).toHaveAttribute('href', '/settings#push');
      expect(router.state.location.pathname).toBe('/habits/new');
      expect(screen.queryByRole('button', { name: 'Create habit' })).toBeNull();
    });

    it('sends no reminder times when every channel is off, and says nothing will go out', async () => {
      const subscribe = vi.spyOn(push, 'subscribe');
      const fetch = mockFetch();
      renderPage();
      (await fetch.next('GET', '/api/habit-templates')).respond(200, []);

      await user().type(await screen.findByLabelText('Name', { exact: true }), 'Water');
      fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: '08:00' } });
      await user().click(screen.getByRole('checkbox', { name: 'Notifications on this device' }));
      expect(screen.getByText(/No reminders will go out for this habit/)).toBeInTheDocument();
      await user().click(screen.getByRole('button', { name: 'Create habit' }));

      expect((await fetch.next('POST', '/api/habits')).body).toEqual({
        name: 'Water',
        frequency: 'daily',
        timesPerDay: 1,
        reminderChannels: [],
      });
      expect(subscribe).not.toHaveBeenCalled();
    });
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
    expect(create.body).toEqual({ name: 'Stretch', frequency: 'weekly', weeklyTarget: 4, reminderTimes: ['07:30'] });
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
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });

    await fetch.next('POST', '/api/habits');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch.all.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('says how reminders can reach an account that has no channel yet, linking Discord where push is not offered', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    (await fetch.next('GET', '/api/habit-templates')).respond(200, [template]);

    await user.click(await screen.findByRole('button', { name: /Walk/ }));

    expect(await screen.findByText(/Reminders reach you through Discord or notifications on this device/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn one on in Settings.' })).toHaveAttribute('href', '/settings#discord');
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
