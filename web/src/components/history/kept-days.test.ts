import { describe, expect, it } from 'vitest';
import type { DayEntry, Weekday } from '@/lib/models';
import { habit } from '@/lib/test-support';
import { keptDays } from './kept-days';

const today = '2026-11-04';
const done = (date: string): DayEntry => ({ date, state: 'done', completed: true, count: 1 });

describe('keptDays', () => {
  it('counts a low day as kept', () => {
    expect(keptDays(habit, [done('2026-11-02'), done('2026-11-03')], ['2026-11-01'], today, 7)).toEqual({ kept: 3, span: 7 });
  });

  it('skips low days on the rest days of a weekdays habit but keeps a done rest day', () => {
    const weekdaysHabit = { ...habit, frequency: 'weekdays' as const, days: ['mon', 'tue', 'wed', 'thu', 'fri'] as Weekday[] };

    expect(keptDays(weekdaysHabit, [done('2026-11-01')], ['2026-10-31', '2026-11-02'], today, 7).kept).toBe(2);
  });

  it('counts only from the start of a habit younger than the window', () => {
    const young = { ...habit, startDate: '2026-10-26' };

    expect(keptDays(young, [done('2026-10-27')], ['2026-10-20', '2026-10-28'], today, 30)).toEqual({ kept: 2, span: 10 });
  });

  it('leaves out low days in a paused period', () => {
    const paused = { ...habit, pausedFrom: '2026-10-20', pausedUntil: '2026-10-25' };

    expect(keptDays(paused, [], ['2026-10-19', '2026-10-22', '2026-10-26'], today, 30).kept).toBe(2);
  });

  it('keeps only fully done days of a several-times-a-day habit', () => {
    const days: DayEntry[] = [
      { date: '2026-11-02', state: 'partial', completed: null, count: 2 },
      { date: '2026-11-03', state: 'done', completed: true, count: 3 },
    ];

    expect(keptDays({ ...habit }, days, [], today, 7).kept).toBe(1);
  });

  it('leaves out days before the window', () => {
    expect(keptDays(habit, [done('2026-10-28'), done('2026-10-29')], ['2026-10-27'], today, 7).kept).toBe(1);
  });
});
