import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Habit, HabitStats } from '@/lib/models';
import { habit } from '@/lib/test-support';
import { StatTiles } from './stat-tiles';

function show(
  stats: Partial<HabitStats>,
  month: { doneInMonth: number | null; lowDaysInMonth: number } = { doneInMonth: null, lowDaysInMonth: 0 },
  showStreaks = true,
) {
  const subject: Habit = { ...habit, stats: { ...habit.stats, ...stats } };
  return render(<StatTiles habit={subject} monthName="October" {...month} showStreaks={showStreaks} />);
}

describe('StatTiles', () => {
  it('says "Fresh start" for a daily habit without a streak', () => {
    show({ streak: 0 });

    expect(screen.getByText('Fresh start')).toBeInTheDocument();
  });

  it('shows the live streak and never "Fresh start" beside it', () => {
    show({ streak: 4 });

    expect(screen.getByText('4 days')).toBeInTheDocument();
    expect(screen.queryByText('Fresh start')).toBeNull();
  });

  it('leaves the Best tile out when there is no best streak', () => {
    show({ bestStreak: 0 });
    expect(screen.queryByText('Best')).toBeNull();
  });

  it('shows the Best tile with the best streak', () => {
    show({ bestStreak: 9 });

    expect(screen.getByText('Best')).toBeInTheDocument();
    expect(screen.getByText('9 days')).toBeInTheDocument();
  });

  it('leaves the streak tiles out when streaks are off and keeps the others', () => {
    show({ streak: 4, bestStreak: 9 }, { doneInMonth: 6, lowDaysInMonth: 0 }, false);

    expect(screen.queryByText('Current streak')).toBeNull();
    expect(screen.queryByText('Best')).toBeNull();
    expect(screen.getByText('In October')).toBeInTheDocument();
  });

  it('renders no empty list when streaks are off and nothing else is there yet', () => {
    const { container } = show({ streak: 0, bestStreak: 0 }, undefined, false);

    expect(container.querySelector('dl')).toBeNull();
  });

  it('leaves the month tile out at 0 done', () => {
    show({}, { doneInMonth: 0, lowDaysInMonth: 2 });

    expect(screen.queryByText('In October')).toBeNull();
  });

  it('shows the month tile with done and low days', () => {
    show({}, { doneInMonth: 12, lowDaysInMonth: 2 });

    expect(screen.getByText('In October')).toBeInTheDocument();
    expect(screen.getByText('12 done · 2 low days')).toBeInTheDocument();
  });

  it('shows weekly progress when something is done this week', () => {
    show({ streak: null, week: { done: 2, target: 3 } });

    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.queryByText('Current streak')).toBeNull();
  });

  it('shows the weekly target when nothing is done this week', () => {
    show({ streak: null, week: { done: 0, target: 3 } });

    expect(screen.getByText('3 a week')).toBeInTheDocument();
  });
});

describe('StatTiles kept days', () => {
  const render7And30 = (last7Days: { kept: number; span: number }, last30Days: { kept: number; span: number }) =>
    render(<StatTiles habit={habit} monthName="October" doneInMonth={null} lowDaysInMonth={0} last7Days={last7Days} last30Days={last30Days} showStreaks />);

  it('shows the kept days of the last 7 and 30 days', () => {
    render7And30({ kept: 6, span: 7 }, { kept: 24, span: 30 });

    expect(screen.getByText('Last 7 days').nextSibling).toHaveTextContent('Kept 6 of 7');
    expect(screen.getByText('Last 30 days').nextSibling).toHaveTextContent('Kept 24 of 30');
  });

  it('leaves a window out when nothing was kept in it', () => {
    render7And30({ kept: 0, span: 7 }, { kept: 3, span: 30 });

    expect(screen.queryByText('Last 7 days')).toBeNull();
    expect(screen.getByText('Kept 3 of 30')).toBeInTheDocument();
  });

  it('counts a habit younger than 30 days since it started', () => {
    render7And30({ kept: 5, span: 7 }, { kept: 9, span: 12 });

    expect(screen.getByText('Since it started').nextSibling).toHaveTextContent('Kept 9 of 12');
  });

  it('shows one "since it started" tile for a habit younger than a week', () => {
    render7And30({ kept: 2, span: 3 }, { kept: 2, span: 3 });

    expect(screen.getAllByText('Since it started')).toHaveLength(1);
    expect(screen.getByText('Kept 2 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/^Last \d+ days$/)).toBeNull();
  });
});
