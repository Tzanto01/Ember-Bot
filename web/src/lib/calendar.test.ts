import { describe, expect, it } from 'vitest';
import type { DayState } from './models';
import {
  buildMonth,
  type CalendarDay,
  canGoNext,
  canGoPrevious,
  dayLabel,
  dayStateWords,
  monthRange,
} from './calendar';

const month = '2026-11-15';
const startDate = '2026-11-05';
const today = '2026-11-10';

describe('buildMonth', () => {
  const weeks = buildMonth(
    month,
    [
      { date: '2026-11-06', state: 'done', completed: true, count: 1 },
      { date: '2026-11-08', state: 'paused', completed: null, count: 0 },
    ],
    ['2026-11-07', '2026-11-08', '2026-11-20'],
    startDate,
    today,
  );
  const cells = weeks.flat();
  const cell = (date: string) => cells.find((c) => c.date === date) as CalendarDay;

  it('lays out full Monday-start weeks of seven days', () => {
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe('2026-10-26');
    expect(weeks[5][6].date).toBe('2026-12-06');
  });

  it('marks padding cells outside the month and never makes them editable', () => {
    expect(cell('2026-10-31').inMonth).toBe(false);
    expect(cell('2026-12-01').inMonth).toBe(false);
    expect(cell('2026-10-31').editable).toBe(false);
    expect(cell('2026-11-15').inMonth).toBe(true);
  });

  it('resolves each cell to the right state', () => {
    expect(cell('2026-11-03').state).toBe('beforestart');
    expect(cell('2026-11-05').state).toBe('notdone');
    expect(cell('2026-11-06').state).toBe('done');
    expect(cell('2026-11-07').state).toBe('lowday');
    expect(cell('2026-11-09').state).toBe('notdone');
    expect(cell('2026-11-10').state).toBe('pending');
    expect(cell('2026-11-11').state).toBeNull();
  });

  it('lets the server state win over the low day list while still flagging the low day', () => {
    expect(cell('2026-11-08').state).toBe('paused');
    expect(cell('2026-11-08').lowDay).toBe(true);
    expect(cell('2026-11-09').lowDay).toBe(false);
  });

  it('allows edits only from the start date through today inside the month', () => {
    expect(cell('2026-11-04').editable).toBe(false);
    expect(cell('2026-11-05').editable).toBe(true);
    expect(cell('2026-11-10').editable).toBe(true);
    expect(cell('2026-11-11').editable).toBe(false);
    expect(cell('2026-11-20').editable).toBe(false);
  });

  it('flags only today', () => {
    expect(cells.filter((c) => c.isToday).map((c) => c.date)).toEqual([today]);
  });
});

describe('monthRange', () => {
  it('covers the whole month for a past month after the start', () => {
    expect(monthRange('2026-11-15', '2026-01-01', '2026-12-20')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('clamps to the start date and to today', () => {
    expect(monthRange(month, startDate, today)).toEqual({ from: startDate, to: today });
  });

  it('is null when the month has no days between start and today', () => {
    expect(monthRange('2026-09-10', startDate, today)).toBeNull();
    expect(monthRange('2026-12-10', startDate, today)).toBeNull();
  });
});

describe('month paging', () => {
  it('stops going back at the habit start month', () => {
    expect(canGoPrevious('2026-11-15', '2026-10-20')).toBe(true);
    expect(canGoPrevious('2026-10-15', '2026-10-20')).toBe(false);
  });

  it('stops going forward at the current month', () => {
    expect(canGoNext('2026-10-15', today)).toBe(true);
    expect(canGoNext('2026-11-15', today)).toBe(false);
  });
});

describe('dayLabel', () => {
  const day = (state: DayState | null, isToday = false): CalendarDay => ({
    date: today,
    state,
    editable: true,
    inMonth: true,
    isToday,
    lowDay: false,
    count: 0,
  });
  const states: DayState[] = ['beforestart', 'done', 'notdone', 'pending', 'lowday', 'paused', 'offday', 'partial'];

  it('never says "missed" for any state', () => {
    for (const state of states) {
      expect(dayStateWords[state]).not.toMatch(/miss/i);
      expect(dayLabel(day(state)).toLowerCase()).not.toContain('miss');
      expect(dayLabel(day(state, true)).toLowerCase()).not.toContain('miss');
    }
  });

  it('gives every state and a future day a distinct non-empty label', () => {
    const labels = [...states.map((s) => dayLabel(day(s))), dayLabel(day(null))];
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('prefixes today for a checked-in day', () => {
    expect(dayLabel(day('done', true))).toContain(dayLabel(day('done')));
    expect(dayLabel(day('done', true))).not.toBe(dayLabel(day('done')));
  });
});
