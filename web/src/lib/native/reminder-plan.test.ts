import { describe, expect, it } from 'vitest';
import type { Habit } from '../models';
import { planReminders, zonedToUtc } from './reminder-plan';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 1,
    name: 'Walk',
    frequency: 'daily',
    weeklyTarget: null,
    days: null,
    timesPerDay: 1,
    routineId: null,
    reminderTime: '20:00',
    pausedFrom: null,
    pausedUntil: null,
    pausedToday: false,
    createdAt: '2026-01-01T00:00:00Z',
    startDate: '2026-01-01',
    today: { date: '2026-11-02', state: 'pending', completed: null, count: 0 },
    stats: { streak: 0, graceUsed: 0, bestStreak: 0, last7: 0, week: null },
    reminderChannels: ['mobile'],
    ...overrides,
  };
}

const berlinMorning = Date.parse('2026-11-02T10:00:00Z');
const dates = (habits: Habit[], zone = 'Europe/Berlin', now = berlinMorning) =>
  planReminders(habits, zone, now).map((r) => r.date);

describe('planReminders', () => {
  it('schedules only habits with the mobile channel and a reminder time', () => {
    const plan = planReminders(
      [
        habit({ id: 1 }),
        habit({ id: 2, reminderChannels: ['discord', 'webpush'] }),
        habit({ id: 3, reminderChannels: undefined }),
        habit({ id: 4, reminderTime: null }),
      ],
      'Europe/Berlin',
      berlinMorning,
    );

    expect(new Set(plan.map((r) => r.habitId))).toEqual(new Set([1]));
    expect(plan).toHaveLength(7);
  });

  it('plans seven local days starting today at the reminder time in the account zone', () => {
    const plan = planReminders([habit()], 'Europe/Berlin', berlinMorning);

    expect(plan.map((r) => r.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(plan[0].at).toBe(Date.parse('2026-11-02T19:00:00Z'));
  });

  it('follows the account time zone for the day boundary, not the process zone', () => {
    const nearMidnight = Date.parse('2026-11-02T04:30:00Z');
    const lateEvening = habit({ reminderTime: '23:45' });

    const newYork = planReminders([lateEvening], 'America/New_York', nearMidnight);
    const berlin = planReminders([lateEvening], 'Europe/Berlin', nearMidnight);

    expect(newYork[0].date).toBe('2026-11-01');
    expect(newYork[0].at).toBe(Date.parse('2026-11-02T04:45:00Z'));
    expect(berlin[0].date).toBe('2026-11-02');
    expect(berlin[0].at).toBe(Date.parse('2026-11-02T22:45:00Z'));
  });

  it('skips instants that are already past', () => {
    expect(dates([habit({ reminderTime: '09:00' })])).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('skips days before the habit started', () => {
    expect(dates([habit({ startDate: '2026-11-04' })])).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('skips days inside the pause window, bounds included', () => {
    expect(dates([habit({ pausedFrom: '2026-11-04', pausedUntil: '2026-11-05' })])).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('skips today when it is already done but keeps tomorrow', () => {
    const done = habit({ today: { date: '2026-11-02', state: 'done', completed: true, count: 1 } });

    expect(dates([done]).slice(0, 2)).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('keeps the local reminder time on both sides of a DST change', () => {
    const plan = planReminders(
      [
        habit({
          reminderTime: '09:00',
          today: { date: '2026-10-23', state: 'pending', completed: null, count: 0 },
        }),
      ],
      'Europe/Berlin',
      Date.parse('2026-10-23T00:00:00Z'),
    );

    expect(plan.map((r) => [r.date, new Date(r.at).toISOString()])).toEqual([
      ['2026-10-23', '2026-10-23T07:00:00.000Z'],
      ['2026-10-24', '2026-10-24T07:00:00.000Z'],
      ['2026-10-25', '2026-10-25T08:00:00.000Z'],
      ['2026-10-26', '2026-10-26T08:00:00.000Z'],
      ['2026-10-27', '2026-10-27T08:00:00.000Z'],
      ['2026-10-28', '2026-10-28T08:00:00.000Z'],
      ['2026-10-29', '2026-10-29T08:00:00.000Z'],
    ]);
  });

  it('sorts soonest first, numbers ids from 1 and keeps the soonest 60', () => {
    const habits = Array.from({ length: 10 }, (_, i) =>
      habit({ id: i + 1, reminderTime: `${String(12 + i).padStart(2, '0')}:00` }),
    );

    const plan = planReminders(habits.reverse(), 'Europe/Berlin', berlinMorning);

    expect(plan).toHaveLength(60);
    expect(plan.map((r) => r.id)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(plan.map((r) => r.at)).toEqual([...plan.map((r) => r.at)].sort((a, b) => a - b));
    expect(plan[0].habitId).toBe(1);
    expect(plan[59].date).toBe('2026-11-07');
  });
});

describe('zonedToUtc', () => {
  it('moves a time inside the spring-forward gap to the first valid time after it', () => {
    expect(new Date(zonedToUtc('2026-03-29', '02:30', 'Europe/Berlin')).toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    );
  });

  it('uses the first occurrence of an ambiguous fall-back time', () => {
    expect(new Date(zonedToUtc('2026-10-25', '02:30', 'Europe/Berlin')).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('converts an ordinary local time with the zone offset of that day', () => {
    expect(new Date(zonedToUtc('2026-11-02', '09:00', 'Europe/Berlin')).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
  });
});
