import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit } from '@/lib/models';
import { auth, push } from '@/lib/services';
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

async function load(fetch: FetchMock, data: Habit = stretch, today = me.localToday, who = me) {
  (await fetch.next('GET', '/api/me')).respond(200, { ...who, localToday: today });
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    push.available.set(false);
    push.subscribed.set(false);
  });

  it('shows every saved reminder time, and saves an added one with the times sorted', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    const water: Habit = {
      ...stretch,
      timesPerDay: 3,
      reminderTime: '08:00',
      reminderTimes: ['08:00', '20:00'],
      reminderChannels: ['discord'],
    };
    await load(fetch, water);

    expect(screen.getByLabelText('Reminder time 1')).toHaveValue('08:00');
    expect(screen.getByLabelText('Reminder time 2')).toHaveValue('20:00');
    expect(screen.getByRole('button', { name: 'Remove 20:00' })).toBeInTheDocument();
    expect(screen.getByText("Ember reminds you at 08:00 and 20:00 until you've checked in 3 times.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add another time' }));
    fireEvent.change(screen.getByLabelText('Reminder time 3'), { target: { value: '13:00' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const patch = await fetch.next('PATCH', '/api/habits/7');
    expect(patch.body).toEqual({ reminderTimes: ['08:00', '13:00', '20:00'] });
    patch.respond(200, { ...water, reminderTimes: ['08:00', '13:00', '20:00'] });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Reminder time 2')).toHaveValue('13:00');
  });

  it('asks this browser for notifications when a reminder time is set on a habit that notifies this device', async () => {
    push.available.set(true);
    vi.spyOn(push, 'check').mockResolvedValue();
    const subscribe = vi.spyOn(push, 'subscribe').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    await load(fetch, { ...stretch, reminderTime: null, reminderTimes: [], reminderChannels: ['webpush'] });

    fireEvent.change(screen.getByLabelText(/Reminder time/), { target: { value: '07:00' } });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const patch = await fetch.next('PATCH', '/api/habits/7');
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(patch.body).toEqual({ reminderTimes: ['07:00'] });
    patch.respond(200, { ...stretch, reminderTimes: ['07:00'], reminderChannels: ['webpush'] });
    expect(await screen.findByText(/Notifications are off for Ember in this browser/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Notifications on this device' })).toBeChecked();
  });

  it.each([
    ['Discord DM', 'discord'],
    ['Notifications on this device', 'webpush'],
  ])('drops mobile when %s is added to a mobile-only habit', async (label, channel) => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage();
    await load(fetch, stretch, me.localToday, { ...me, discord: { linked: true, id: '1' } });

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
  it("shows the saved schedule and the routine reminder that replaces the habit's own", async () => {
    const fetch = mockFetch();
    renderPage();
    const scheduled: Habit = { ...stretch, frequency: 'weekdays', days: ['mon', 'wed'], timesPerDay: 2, routineId: 5 };
    (await fetch.next('GET', '/api/me')).respond(200, me);
    (await fetch.next('GET', '/api/habits/7')).respond(200, scheduled);
    (await fetch.next('GET', '/api/routines')).respond(200, [
      { id: 5, name: 'Morning', reminderTime: '07:30', reminderChannels: ['mobile'], habitIds: [7] },
    ]);

    expect(await screen.findByText(/Your Morning routine reminds you at 07:30 instead/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'On set days' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Wednesday' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).not.toBeChecked();
    expect(screen.getByLabelText('Times a day')).toHaveValue('2');

    await userEvent.selectOptions(screen.getByLabelText('Times a day'), '1');
    expect(screen.getByText('Past days stay as they are.')).toBeInTheDocument();
  });
});
