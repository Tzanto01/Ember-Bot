import { describe, expect, it } from 'vitest';
import type { Habit, Routine } from '../models';
import { planCap, planDays, planReminders, zonedToUtc } from './reminder-plan';

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
const firstWeek = (date: string) => date <= '2026-11-08';
const dates = (habits: Habit[], zone = 'Europe/Berlin', now = berlinMorning) =>
  planReminders(habits, zone, now)
    .map((r) => r.date)
    .filter(firstWeek);

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
    expect(plan).toHaveLength(planDays);
  });

  it('plans thirty local days starting today at the reminder time in the account zone', () => {
    const plan = planReminders([habit()], 'Europe/Berlin', berlinMorning);

    expect(plan).toHaveLength(30);
    expect(plan.at(-1)?.date).toBe('2026-12-01');
    expect(plan.map((r) => r.date).filter(firstWeek)).toEqual([
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

  it('fires a weekdays habit only on its scheduled days', () => {
    expect(dates([habit({ frequency: 'weekdays', days: ['mon', 'wed'] })])).toEqual([
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('skips today once a multi-count habit reaches its count, but keeps a partial day', () => {
    const done = habit({
      timesPerDay: 3,
      today: { date: '2026-11-02', state: 'partial', completed: null, count: 3 },
    });
    const partial = habit({
      timesPerDay: 3,
      today: { date: '2026-11-02', state: 'partial', completed: null, count: 1 },
    });

    expect(dates([done])[0]).toBe('2026-11-03');
    expect(dates([partial])[0]).toBe('2026-11-02');
  });

  it("plans a routine's reminder instead of its members' own, once a day while a member is pending", () => {
    const routine: Routine = {
      id: 7,
      name: 'Evening',
      reminderTime: '18:00',
      reminderChannels: ['mobile'],
      habitIds: [1, 2],
    };
    const plan = planReminders(
      [habit({ id: 1 }), habit({ id: 2, reminderTime: null }), habit({ id: 3 })],
      'Europe/Berlin',
      berlinMorning,
      [routine],
    );

    expect(plan.filter((r) => r.habitId === 1)).toEqual([]);
    expect(plan.filter((r) => r.routineId === 7).map((r) => r.date)).toHaveLength(planDays);
    expect(plan.find((r) => r.routineId === 7)?.at).toBe(Date.parse('2026-11-02T17:00:00Z'));
    expect(plan.filter((r) => r.habitId === 3)).toHaveLength(planDays);
  });

  it('plans no routine reminder today when none of its habits is still pending', () => {
    const routine: Routine = {
      id: 7,
      name: 'Evening',
      reminderTime: '18:00',
      reminderChannels: ['mobile'],
      habitIds: [1, 2],
    };
    const done = { date: '2026-11-02', state: 'done' as const, completed: true, count: 1 };
    const rest = { date: '2026-11-02', state: 'offday' as const, completed: null, count: 0 };

    const plan = planReminders(
      [habit({ id: 1, today: done }), habit({ id: 2, today: rest })],
      'Europe/Berlin',
      berlinMorning,
      [routine],
    );

    expect(plan[0]).toMatchObject({ routineId: 7, date: '2026-11-03' });
    expect(plan.some((r) => r.habitId !== undefined)).toBe(false);
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

    expect(plan.slice(0, 7).map((r) => [r.date, new Date(r.at).toISOString()])).toEqual([
      ['2026-10-23', '2026-10-23T07:00:00.000Z'],
      ['2026-10-24', '2026-10-24T07:00:00.000Z'],
      ['2026-10-25', '2026-10-25T08:00:00.000Z'],
      ['2026-10-26', '2026-10-26T08:00:00.000Z'],
      ['2026-10-27', '2026-10-27T08:00:00.000Z'],
      ['2026-10-28', '2026-10-28T08:00:00.000Z'],
      ['2026-10-29', '2026-10-29T08:00:00.000Z'],
    ]);
  });

  it('sorts soonest first, numbers ids from 1 and keeps the soonest 400', () => {
    const habits = Array.from({ length: 20 }, (_, i) =>
      habit({ id: i + 1, reminderTime: `${12 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}` }),
    );

    const plan = planReminders(habits.reverse(), 'Europe/Berlin', berlinMorning);

    expect(planCap).toBe(400);
    expect(plan).toHaveLength(400);
    expect(plan.map((r) => r.id)).toEqual(Array.from({ length: 400 }, (_, i) => i + 1));
    expect(plan.map((r) => r.at)).toEqual([...plan.map((r) => r.at)].sort((a, b) => a - b));
    expect(plan[0].habitId).toBe(1);
    expect(plan[399].date).toBe('2026-11-21');
  });

  it('plans a second reminder the chosen minutes after each one, for the same habit or routine and date', () => {
    const routine: Routine = {
      id: 7,
      name: 'Evening',
      reminderTime: '18:00',
      reminderChannels: ['mobile'],
      habitIds: [2],
    };
    const plan = planReminders(
      [habit({ id: 1 }), habit({ id: 2 })],
      'Europe/Berlin',
      berlinMorning,
      [routine],
      30,
    );

    expect(
      plan
        .filter((r) => r.date === '2026-11-02')
        .map((r) => [r.habitId ?? r.routineId, r.second ?? false, new Date(r.at).toISOString()]),
    ).toEqual([
      [7, false, '2026-11-02T17:00:00.000Z'],
      [7, true, '2026-11-02T17:30:00.000Z'],
      [1, false, '2026-11-02T19:00:00.000Z'],
      [1, true, '2026-11-02T19:30:00.000Z'],
    ]);
    expect(plan.filter((r) => r.second)).toHaveLength(2 * planDays);
  });

  it('plans no second reminder when it is off', () => {
    expect(planReminders([habit()], 'Europe/Berlin', berlinMorning).some((r) => r.second)).toBe(
      false,
    );
  });

  it('drops a second reminder that would fall on the next local day', () => {
    const plan = planReminders(
      [habit({ reminderTime: '23:30' })],
      'Europe/Berlin',
      berlinMorning,
      [],
      60,
    );

    expect(plan).toHaveLength(planDays);
    expect(plan.some((r) => r.second)).toBe(false);
    expect(
      planReminders(
        [habit({ reminderTime: '23:30' })],
        'Europe/Berlin',
        berlinMorning,
        [],
        15,
      ).filter((r) => r.second),
    ).toHaveLength(planDays);
  });

  it('keeps the second reminder of a first one that already fired', () => {
    const plan = planReminders(
      [habit()],
      'Europe/Berlin',
      Date.parse('2026-11-02T19:10:00Z'),
      [],
      30,
    );

    expect(plan[0]).toMatchObject({
      id: 1,
      date: '2026-11-02',
      second: true,
      at: Date.parse('2026-11-02T19:30:00Z'),
    });
    expect(plan[1]).toMatchObject({ date: '2026-11-03' });
  });

  it('keeps ids unique and the soonest 400 with second reminders on', () => {
    const habits = Array.from({ length: 10 }, (_, i) =>
      habit({ id: i + 1, reminderTime: `${String(12 + i).padStart(2, '0')}:00` }),
    );

    const plan = planReminders(habits, 'Europe/Berlin', berlinMorning, [], 15);

    expect(plan).toHaveLength(planCap);
    expect(new Set(plan.map((r) => r.id)).size).toBe(planCap);
    expect(plan.map((r) => r.at)).toEqual([...plan.map((r) => r.at)].sort((a, b) => a - b));
    expect(plan[1]).toMatchObject({
      habitId: 1,
      second: true,
      at: Date.parse('2026-11-02T11:15:00Z'),
    });
    expect(plan[planCap - 1].date).toBe('2026-11-21');
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
