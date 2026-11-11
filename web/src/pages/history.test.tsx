import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayEntry, Habit } from '@/lib/models';
import { auth } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
import HistoryPage from './history';

const localToday = '2026-11-04';

function renderHistory(path = '/history') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/history', Component: HistoryPage },
      { path: '/history/:habitId', Component: HistoryPage },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return view.container;
}

async function answerHabits(f: FetchMock, habits: Habit[]) {
  (await f.next('GET', '/api/me')).respond(200, { ...me, localToday });
  (await f.next('GET', '/api/habits')).respond(200, habits);
}

async function answerMonth(f: FetchMock, id: number, from: string, to: string, days: DayEntry[] = []) {
  (await f.next('GET', `/api/habits/${id}/days?from=${from}&to=${to}`)).respond(200, days);
  (await f.next('GET', `/api/low-days?from=${from}&to=${to}`)).respond(200, []);
}

const dayButtonIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button[id^="day-"]')).map((b) => b.id);

describe('HistoryPage', () => {
  let f: FetchMock;

  beforeEach(() => {
    f = mockFetch();
    auth.setMe(me);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  it('makes only the editable days of the shown month day buttons', async () => {
    const container = renderHistory();
    await answerHabits(f, [{ ...habit, startDate: '2026-11-02' }]);
    await answerMonth(f, 1, '2026-11-02', '2026-11-04');

    await waitFor(() =>
      expect(dayButtonIds(container)).toEqual(['day-2026-11-02', 'day-2026-11-03', 'day-2026-11-04']),
    );
    for (const id of dayButtonIds(container)) {
      expect(container.querySelector(`#${id}`)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('follows the server\'s local day, not the stale cached one, when choosing the month', async () => {
    auth.setMe({ ...me, localToday: '2026-10-31' });
    renderHistory('/history/1');

    (await f.next('GET', '/api/me')).respond(200, { ...me, localToday: '2026-11-02' });
    (await f.next('GET', '/api/habits')).respond(200, [habit]);

    await answerMonth(f, 1, '2026-11-01', '2026-11-02');
    expect(f.all.some((c) => c.url.includes('to=2026-10-'))).toBe(false);
  });

  it('marks a day done from the day panel and shows it as done', async () => {
    const container = renderHistory();
    await answerHabits(f, [habit]);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04');
    const day = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('#day-2026-11-03');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(day).toHaveAttribute('data-state', 'notdone');

    await userEvent.click(day);
    expect(day).toHaveAttribute('aria-expanded', 'true');
    const panel = container.querySelector<HTMLElement>('#day-panel')!;
    expect(panel.querySelector('#day-panel-heading')).toHaveFocus();

    await userEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    const put = await f.next('PUT', '/api/habits/1/days/2026-11-03');
    expect(put.body).toEqual({ completed: true });
    put.respond(200, habit);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04', [
      { date: '2026-11-03', state: 'done', completed: true, count: 1 },
    ]);

    await waitFor(() => expect(day).toHaveAttribute('data-state', 'done'));
    expect(await screen.findByText(/marked done\.$/)).toBeInTheDocument();
  });

  it("pages months only between the habit's start month and the current month", async () => {
    renderHistory('/history/1');
    await answerHabits(f, [{ ...habit, startDate: '2026-10-15' }]);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04');
    await answerMonth(f, 1, '2026-10-15', '2026-11-04');

    const previous = await screen.findByRole('button', { name: 'Previous month' });
    const next = screen.getByRole('button', { name: 'Next month' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toHaveAttribute('aria-disabled');

    await userEvent.click(next);
    expect(f.pending).toEqual([]);

    await userEvent.click(previous);
    await answerMonth(f, 1, '2026-10-15', '2026-10-31');
    expect(await screen.findByRole('button', { name: 'Previous month' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next month' })).not.toHaveAttribute('aria-disabled');

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(f.pending).toEqual([]);
  });

  it('closes the open day when the month changes, so coming back does not reopen it', async () => {
    const container = renderHistory('/history/1');
    await answerHabits(f, [{ ...habit, startDate: '2026-10-15' }]);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04');
    await userEvent.click(await screen.findByRole('button', { name: /3 November|November 3/ }));
    expect(container.querySelector('#day-panel')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await answerMonth(f, 1, '2026-10-15', '2026-10-31');
    await userEvent.click(await screen.findByRole('button', { name: 'Next month' }));
    await answerMonth(f, 1, '2026-11-01', '2026-11-04');

    await waitFor(() => expect(container.querySelector('#day-2026-11-03')).not.toBeNull());
    expect(container.querySelector('#day-2026-11-03')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('#day-panel')).toBeNull();
  });
  it('names a partly done day "2 of 3 done" and steps its count with an absolute value', async () => {
    const container = renderHistory();
    await answerHabits(f, [{ ...habit, timesPerDay: 3 }]);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04', [
      { date: '2026-11-03', state: 'partial', completed: null, count: 2 },
    ]);

    const day = await screen.findByRole('button', { name: /(3 November|November 3).*, 2 of 3 done$/ });
    await userEvent.click(day);
    const panel = container.querySelector<HTMLElement>('#day-panel')!;
    expect(within(panel).getByText('2 of 3 done')).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'One more check-in' }));
    expect((await f.next('PUT', '/api/habits/1/days/2026-11-03')).body).toEqual({ count: 3 });
  });

  it('shows the kept days of the last 7 and 30 days for a daily habit, low days included', async () => {
    renderHistory();
    await answerHabits(f, [habit]);
    await answerMonth(f, 1, '2026-11-01', '2026-11-04');
    (await f.next('GET', '/api/habits/1/days?from=2026-10-06&to=2026-11-04')).respond(200, [
      { date: '2026-10-10', state: 'done', completed: true, count: 1 },
      { date: '2026-11-03', state: 'done', completed: true, count: 1 },
    ]);
    (await f.next('GET', '/api/low-days?from=2026-10-06&to=2026-11-04')).respond(200, ['2026-11-02']);

    expect((await screen.findByText('Last 7 days')).nextSibling).toHaveTextContent('Kept 2 of 7');
    expect(screen.getByText('Last 30 days').nextSibling).toHaveTextContent('Kept 3 of 30');
  });
});
