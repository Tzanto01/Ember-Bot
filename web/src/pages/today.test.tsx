import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit, WeeklyStats } from '@/lib/models';
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
  { localToday = '2026-11-01', stats = weekly }: { localToday?: string; stats?: WeeklyStats } = {},
) {
  (await f.next('GET', '/api/me')).respond(200, { ...me, localToday });
  (await f.next('GET', '/api/habits')).respond(200, habits);
  (await f.next('GET', `/api/low-days?from=${localToday}&to=${localToday}`)).respond(200, []);
  (await f.next('GET', '/api/stats/weekly')).respond(200, stats);
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
          else if (call.url === '/api/me') call.respond(200, { ...me, localToday: '2026-11-01' });
        }
        expect(screen.getByRole('heading', { name: 'Read' })).toBeInTheDocument();
      },
      { timeout: 2000, interval: 20 },
    );
  });
});
