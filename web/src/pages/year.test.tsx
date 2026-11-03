import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeJournal, renderWithJournal } from '@/components/journal/fake-journal';
import { addDays } from '@/lib/local-date';
import type { DayStat } from '@/lib/models';
import { auth } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
import YearPage from './year';

const localToday = '2026-11-04';
const yearFrom = '2025-11-10';

function stat(date: string, showedUp: boolean, done = showedUp ? 1 : 0, scheduled = 1): DayStat {
  return { date, scheduled, done, partial: 0, showedUp };
}

async function answerStats(f: FetchMock, stats: DayStat[], habits = [habit]) {
  (await f.next('GET', '/api/me')).respond(200, { ...me, localToday });
  (await f.next('GET', '/api/habits')).respond(200, habits);
  (await f.next('GET', `/api/stats/days?from=${yearFrom}&to=${localToday}`)).respond(200, stats);
}

const nov3 = (words: string) => new RegExp(`(November 3,|3 November) 2026: ${words}$`);
const dayButton = (words: string) =>
  waitFor(() => {
    const button = document.querySelector<HTMLElement>('button[data-date="2026-11-03"]');
    expect(button).toHaveAccessibleName(nov3(words));
    return button!;
  });

describe('YearPage', { timeout: 15_000 }, () => {
  let f: FetchMock;

  beforeEach(() => {
    f = mockFetch();
    auth.setMe({ ...me, localToday });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  it('counts the days you showed up in the last 30 days', async () => {
    renderWithJournal(<YearPage />, fakeJournal());
    const recent = Array.from({ length: 30 }, (_, i) => stat(addDays(localToday, -i), i % 5 < 3));
    const older = Array.from({ length: 10 }, (_, i) => stat(addDays(localToday, -40 - i), true));
    await answerStats(f, [...older.reverse(), ...recent.reverse()]);

    expect(await screen.findByText('You showed up 18 of the last 30 days.')).toBeInTheDocument();
  });

  it('words a day without check-ins gently, never as missed', async () => {
    const user = userEvent.setup();
    renderWithJournal(<YearPage />, fakeJournal());
    await answerStats(f, [stat('2026-11-03', false, 0, 2)]);

    await user.click(await dayButton('no check-ins'));

    expect(screen.getByText('No check-ins.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/missed/i);
  });

  it("shows the day's mood while the journal is readable", async () => {
    const user = userEvent.setup();
    renderWithJournal(
      <YearPage />,
      fakeJournal({ notes: [{ date: '2026-11-03', text: 'Quiet walk.', mood: 'great' }] }),
    );
    await answerStats(f, [stat('2026-11-03', true)]);

    await user.click(await dayButton('you showed up, 1 of 1 done, mood Great'));
    expect(screen.getByText('Mood:').parentElement).toHaveTextContent('Great');
  });

  it('shows no moods and a quiet hint while the private journal is locked', async () => {
    const journal = fakeJournal({ state: 'locked', notes: [{ date: '2026-11-03', text: null, mood: 'great' }] });
    renderWithJournal(<YearPage />, journal);
    await answerStats(f, [stat('2026-11-03', true)]);

    expect(await dayButton('you showed up, 1 of 1 done')).toBeInTheDocument();
    expect(screen.getByText(/Moods stay hidden while your private journal is locked/)).toBeInTheDocument();
    expect([...document.querySelectorAll('button[data-date]')].some((b) => /mood/.test(b.getAttribute('aria-label')!))).toBe(false);
    expect(journal.notes).not.toHaveBeenCalled();
  });

  it("switches to one habit's days with the habit picker", async () => {
    const user = userEvent.setup();
    renderWithJournal(<YearPage />, fakeJournal());
    const read = { ...habit, id: 2, name: 'Read', startDate: '2026-10-01' };
    await answerStats(f, [stat('2026-11-03', false)], [habit, read]);
    await dayButton('no check-ins');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'Read');
    (await f.next('GET', `/api/habits/2/days?from=2026-10-01&to=${localToday}`)).respond(200, [
      { date: '2026-11-03', state: 'done', completed: true, count: 1 },
      { date: '2026-11-04', state: 'pending', completed: null, count: 0 },
    ]);

    expect(await dayButton('done')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('You showed up 1 of the last 30 days.')).toBeInTheDocument());
    expect(document.querySelector('button[data-date="2026-09-30"]')).toBeNull();
    expect(document.querySelector('button[data-date="2026-10-01"]')).not.toBeNull();
  });
});
