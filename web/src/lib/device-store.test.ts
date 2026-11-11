import { describe, expect, it } from 'vitest';
import { withDayEdit } from './device-store';
import { habit } from './test-support';

const weekly = {
  ...habit,
  frequency: 'weekly' as const,
  weeklyTarget: 3,
  stats: { ...habit.stats, week: { done: 2, target: 3 } },
};

describe('withDayEdit', () => {
  it('counts an offline check-in that completes the day into the weekly progress, and takes it back when undone', () => {
    const done = withDayEdit(weekly, { habitId: 1, date: '2026-11-01', completed: true });
    expect(done.stats.week?.done).toBe(3);

    expect(withDayEdit(done, { habitId: 1, date: '2026-11-01', completed: null }).stats.week?.done).toBe(2);
  });

  it('leaves daily habits and edits for other days alone', () => {
    expect(withDayEdit(habit, { habitId: 1, date: '2026-11-01', completed: true }).stats).toBe(habit.stats);
    expect(withDayEdit(weekly, { habitId: 1, date: '2026-10-31', completed: true }).stats.week?.done).toBe(2);
  });
});
