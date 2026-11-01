import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Habit } from '@/lib/models';
import { habit } from '@/lib/test-support';
import { HabitRow } from './habit-row';

function show(overrides: Partial<Habit>) {
  const subject: Habit = { ...habit, ...overrides };
  const { container } = render(
    <MemoryRouter>
      <HabitRow habit={subject} busy={false} reward={null} onToggle={() => {}} onRewardEnd={() => {}} />
    </MemoryRouter>,
  );
  return container;
}

const checkButton = () => screen.queryByRole('button', { name: 'Check in Walk for today' });

describe('HabitRow meta line', () => {
  it('shows the streak of a daily habit', () => {
    const row = show({ stats: { ...habit.stats, streak: 4 } });

    expect(row).toHaveTextContent('4-day streak');
    expect(checkButton()).not.toBeNull();
  });

  it('says "Every day" for a daily habit without a streak', () => {
    const row = show({});

    expect(row).toHaveTextContent('Every day');
    expect(row).not.toHaveTextContent('streak');
  });

  it('shows this week\'s progress of a weekly habit', () => {
    const row = show({
      frequency: 'weekly',
      weeklyTarget: 3,
      stats: { ...habit.stats, streak: null, week: { done: 2, target: 3 } },
    });

    expect(row).toHaveTextContent('2 of 3 this week');
  });

  it('says the pause end and offers no check-in for a paused habit', () => {
    const row = show({
      pausedToday: true,
      pausedUntil: '2026-12-15',
      today: { ...habit.today, state: 'paused' },
    });

    expect(row.textContent).toMatch(/Paused until (15 December|December 15)/);
    expect(checkButton()).toBeNull();
  });

  it('says when a habit has not started and offers no check-in', () => {
    const row = show({ startDate: '2026-12-01', today: { ...habit.today, state: 'beforestart' } });

    expect(row.textContent).toMatch(/Starts (1 December|December 1)/);
    expect(checkButton()).toBeNull();
  });

  it('shows the low-day line on a low day and still allows checking in', () => {
    const row = show({ today: { ...habit.today, state: 'lowday' } });

    expect(row).toHaveTextContent('Low day, resting. Checking in is still welcome.');
    expect(checkButton()).not.toBeNull();
  });
});
