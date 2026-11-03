import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit, Routine, WeeklyStats } from '@/lib/models';
import { auth, deviceSync } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
import TodayPage from './today';

const weekly: WeeklyStats = {
  totalDone: 0,
  totalPossible: 0,
  headline: 'A calm week.',
  footer: '',
  habits: [],
};

const doneHabit: Habit = { ...habit, today: { ...habit.today, state: 'done', completed: true } };

function renderToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/today', Component: TodayPage }], { initialEntries: ['/today'] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function answerLoad(
  f: FetchMock,
  habits: Habit[],
  {
    localToday = '2026-11-01',
    stats = weekly,
    routines = [],
  }: { localToday?: string; stats?: WeeklyStats; routines?: Routine[] } = {},
) {
  (await f.next('GET', '/api/me')).respond(200, { ...me, localToday });
  (await f.next('GET', '/api/habits')).respond(200, habits);
  (await f.next('GET', `/api/low-days?from=${localToday}&to=${localToday}`)).respond(200, []);
  (await f.next('GET', '/api/stats/weekly')).respond(200, stats);
  (await f.next('GET', '/api/routines')).respond(200, routines);
}

const checkButton = () => screen.findByRole('button', { name: 'Check in Walk for today' });

describe('TodayPage', () => {
  let f: FetchMock;

  beforeEach(() => {
    f = mockFetch();
    auth.setMe(me);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
    document.documentElement.style.removeProperty('--ember-reward');
  });

  it('looks up low days for the local day reloaded from the server, not the stale cached one', async () => {
    renderToday();

    const meCall = await f.next('GET', '/api/me');
    expect(f.pending.some((c) => c.url.startsWith('/api/low-days'))).toBe(false);
    meCall.respond(200, { ...me, localToday: '2026-11-02' });

    (await f.next('GET', '/api/low-days?from=2026-11-02&to=2026-11-02')).respond(200, []);
    (await f.next('GET', '/api/habits')).respond(200, []);
    (await f.next('GET', '/api/stats/weekly')).respond(200, weekly);
    (await f.next('GET', '/api/routines')).respond(200, []);

    expect(await screen.findByText(/2 November|November 2/)).toBeInTheDocument();
    expect(f.all.some((c) => c.url.includes('2026-11-01'))).toBe(false);
  });

  it('checks in, presses the button and announces it', async () => {
    renderToday();
    await answerLoad(f, [habit]);
    const button = await checkButton();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    const put = await f.next('PUT', '/api/habits/1/days/2026-11-01');
    expect(put.body).toEqual({ completed: true });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    put.respond(200, doneHabit);
    expect(await screen.findByText('Walk: checked in for today.')).toBeInTheDocument();
    expect(await checkButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('rolls a failed check-in back and says it did not save', async () => {
    renderToday();
    await answerLoad(f, [habit]);
    await userEvent.click(await checkButton());

    (await f.next('PUT', '/api/habits/1/days/2026-11-01')).respond(500, { title: 'Server error' });

    expect(await screen.findByRole('alert')).toHaveTextContent("Your check-in for Walk didn't save");
    expect(await checkButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Walk: checked in for today.')).toBeNull();
  });

  it('keeps a newer state when a stale check-in failure arrives after it', async () => {
    renderToday();
    await answerLoad(f, [habit]);
    await userEvent.click(await checkButton());
    const put = await f.next('PUT', '/api/habits/1/days/2026-11-01');

    act(() => deviceSync.synced.update((n) => n + 1));
    await answerLoad(f, [doneHabit], { stats: { ...weekly, headline: 'Synced week.' } });
    expect(await screen.findByText('Synced week.')).toBeInTheDocument();

    put.respond(500, { title: 'Server error' });

    expect(await screen.findByRole('alert')).toHaveTextContent("Your check-in for Walk didn't save");
    expect(await checkButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a check-in made from a reminder or the widget', async () => {
    renderToday();
    await answerLoad(f, [habit]);
    expect(await checkButton()).toHaveAttribute('aria-pressed', 'false');

    act(() => deviceSync.nativeCheckIn.set({ name: 'Walk' }));
    await answerLoad(f, [doneHabit]);

    await waitFor(async () => expect(await checkButton()).toHaveAttribute('aria-pressed', 'true'));
    act(() => deviceSync.nativeCheckIn.set(null));
  });

  it("plays the theme's reward only after the user's own tap, never on first render", async () => {
    document.documentElement.style.setProperty('--ember-reward', 'glow');
    const read = { ...habit, id: 2, name: 'Read', today: { ...doneHabit.today } };
    renderToday();
    await answerLoad(f, [habit, read]);
    const button = await checkButton();
    const alreadyDone = screen.getByRole('button', { name: 'Check in Read for today' });

    expect(button.className).not.toMatch(/ember-reward-/);
    expect(alreadyDone.className).not.toMatch(/ember-reward-/);

    await userEvent.click(button);
    await waitFor(() => expect(button.className).toMatch(/ember-reward-glow/));
    expect(alreadyDone.className).not.toMatch(/ember-reward-/);

    (await f.next('PUT', '/api/habits/1/days/2026-11-01')).respond(200, doneHabit);
    const settled = await checkButton();
    fireEvent(settled, new Event('webkitAnimationEnd', { bubbles: true }));
    await waitFor(() => expect(settled.className).not.toMatch(/ember-reward-/));
  });

  it('marks today as a low day for the local day and shows the low-day notice', async () => {
    renderToday();
    await answerLoad(f, [habit]);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark today as a low day' }));
    (await f.next('PUT', '/api/low-days/2026-11-01')).respond(204);

    expect(await screen.findByText('Today is a low day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark today as a low day' })).toBeNull();
  });

  it('clears the low day with a DELETE and brings the mark button back', async () => {
    renderToday();
    (await f.next('GET', '/api/me')).respond(200, me);
    (await f.next('GET', '/api/habits')).respond(200, [habit]);
    (await f.next('GET', '/api/low-days?from=2026-11-01&to=2026-11-01')).respond(200, ['2026-11-01']);
    (await f.next('GET', '/api/stats/weekly')).respond(200, weekly);
    (await f.next('GET', '/api/routines')).respond(200, []);

    await userEvent.click(await screen.findByRole('button', { name: 'Clear low day' }));
    (await f.next('DELETE', '/api/low-days/2026-11-01')).respond(204);

    expect(await screen.findByRole('button', { name: 'Mark today as a low day' })).toBeInTheDocument();
    expect(screen.queryByText('Today is a low day')).toBeNull();
  });

  it('shows the synced list after a check-in that interrupted a sync refetch', async () => {
    renderToday();
    await answerLoad(f, [habit]);
    const button = await checkButton();

    act(() => deviceSync.synced.update((n) => n + 1));
    await vi.waitFor(() => expect(f.pending.some((c) => c.url === '/api/me')).toBe(true));
    await userEvent.click(button);
    (await f.next('GET', '/api/me')).respond(200, { ...me, localToday: '2026-11-01' });
    (await f.next('PUT', '/api/habits/1/days/2026-11-01')).respond(200, doneHabit);

    const read = { ...habit, id: 2, name: 'Read' };
    await vi.waitFor(
      () => {
        for (const call of [...f.pending]) {
          if (call.url === '/api/habits') call.respond(200, [doneHabit, read]);
          else if (call.url.startsWith('/api/low-days')) call.respond(200, []);
          else if (call.url === '/api/stats/weekly') call.respond(200, weekly);
          else if (call.url === '/api/routines') call.respond(200, []);
          else if (call.url === '/api/me') call.respond(200, { ...me, localToday: '2026-11-01' });
        }
        expect(screen.getByRole('heading', { name: 'Read' })).toBeInTheDocument();
      },
      { timeout: 2000, interval: 20 },
    );
  });
  it('adds one to a multi-count habit with an absolute count and shows the new progress', async () => {
    const water = { ...habit, name: 'Water', timesPerDay: 3, today: { ...habit.today, state: 'partial' as const, count: 1 } };
    renderToday();
    await answerLoad(f, [water]);

    await userEvent.click(await screen.findByRole('button', { name: 'Check in Water for today (1 of 3)' }));
    const put = await f.next('PUT', '/api/habits/1/days/2026-11-01');
    expect(put.body).toEqual({ count: 2 });
    expect(screen.getByRole('button', { name: 'Check in Water for today (2 of 3)' })).toHaveAttribute('aria-pressed', 'false');

    put.respond(200, { ...water, today: { ...water.today, count: 2 } });
    expect(await screen.findByText('Water: 2 of 3 for today.')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 today')).toBeInTheDocument();
  });

  it('shows a rest day as rest, not as open, and returns to rest when its check-in is cleared', async () => {
    const restDone = {
      ...habit,
      frequency: 'weekdays' as const,
      days: ['mon' as const],
      today: { ...habit.today, state: 'done' as const, completed: true, count: 1 },
    };
    renderToday();
    await answerLoad(f, [restDone]);

    await userEvent.click(await checkButton());
    await f.next('DELETE', '/api/habits/1/days/2026-11-01');

    expect(screen.getByText(/Rest day, nothing planned/)).toBeInTheDocument();
    expect(await checkButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it("groups habits under their routines in the routine's order, then the rest", async () => {
    const water = { ...habit, id: 3, name: 'Water' };
    const read = { ...habit, id: 2, name: 'Read' };
    renderToday();
    await answerLoad(f, [habit, read, water], {
      routines: [{ id: 5, name: 'Morning', reminderTime: null, reminderChannels: [], habitIds: [3, 1] }],
    });

    await screen.findByRole('heading', { name: 'Morning' });
    const headings = screen.getAllByRole('heading').map((h) => `${h.tagName} ${h.textContent}`);
    expect(headings.slice(1)).toEqual(['H2 Morning', 'H3 Water', 'H3 Walk', 'H2 Other habits', 'H3 Read', 'H2 Your week', 'H2 How was today?']);
    expect(screen.getByRole('link', { name: 'Edit Morning routine' })).toHaveAttribute('href', '/routines/5/edit');
  });

  it('shows habits ungrouped when routines fail to load', async () => {
    renderToday();
    (await f.next('GET', '/api/me')).respond(200, me);
    (await f.next('GET', '/api/habits')).respond(200, [habit]);
    (await f.next('GET', '/api/low-days?from=2026-11-01&to=2026-11-01')).respond(200, []);
    (await f.next('GET', '/api/stats/weekly')).respond(200, weekly);
    (await f.next('GET', '/api/routines')).respond(500);

    expect(await screen.findByRole('heading', { level: 2, name: 'Walk' })).toBeInTheDocument();
  });
});
