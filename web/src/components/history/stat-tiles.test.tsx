import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Habit, HabitStats } from '@/lib/models';
import { habit } from '@/lib/test-support';
import { StatTiles } from './stat-tiles';

function show(stats: Partial<HabitStats>, month: { doneInMonth: number | null; lowDaysInMonth: number } = { doneInMonth: null, lowDaysInMonth: 0 }) {
  const subject: Habit = { ...habit, stats: { ...habit.stats, ...stats } };
  render(<StatTiles habit={subject} monthName="October" {...month} />);
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
