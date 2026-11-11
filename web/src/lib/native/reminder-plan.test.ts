import { describe, expect, it } from 'vitest';
import type { Habit, Routine } from '../models';
import { planCap, planDays, planReminders, reminderId, zonedToUtc } from './reminder-plan';

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

  it('plans fourteen local days starting today at the reminder time in the account zone', () => {
    const plan = planReminders([habit()], 'Europe/Berlin', berlinMorning);

    expect(plan).toHaveLength(14);
    expect(plan.at(-1)?.date).toBe('2026-11-15');
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

  it('stops a weekly habit for the rest of the week once its target is met, and starts again on Monday', () => {
    const wednesday = Date.parse('2026-11-04T10:00:00Z');
    const weekly = (done: number) =>
      habit({
        frequency: 'weekly',
        weeklyTarget: 3,
        today: { date: '2026-11-04', state: 'pending', completed: null, count: 0 },
        stats: { streak: null, graceUsed: null, bestStreak: null, last7: done, week: { done, target: 3 } },
      });
    const planned = (done: number) =>
      planReminders([weekly(done)], 'Europe/Berlin', wednesday)
        .map((r) => r.date)
        .slice(0, 6);

    expect(planned(2)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    expect(planned(3)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
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

  it('sorts soonest first, gives unique ids and keeps the soonest 400', () => {
    const habits = Array.from({ length: 30 }, (_, i) =>
      habit({ id: i + 1, reminderTime: `${12 + Math.floor(i / 3)}:${['00', '20', '40'][i % 3]}` }),
    );

    const plan = planReminders(habits.reverse(), 'Europe/Berlin', berlinMorning);

    expect(planCap).toBe(400);
    expect(plan).toHaveLength(400);
    expect(new Set(plan.map((r) => r.id)).size).toBe(400);
    expect(plan.map((r) => r.at)).toEqual([...plan.map((r) => r.at)].sort((a, b) => a - b));
    expect(plan[0].habitId).toBe(1);
    expect(plan[399].date).toBe('2026-11-15');
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
      date: '2026-11-02',
      second: true,
      at: Date.parse('2026-11-02T19:30:00Z'),
    });
    expect(plan[1]).toMatchObject({ date: '2026-11-03' });
  });

  it('keeps ids unique and the soonest 400 with second reminders on', () => {
    const habits = Array.from({ length: 20 }, (_, i) =>
      habit({ id: i + 1, reminderTime: `${12 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}` }),
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
    expect(plan[planCap - 1].date).toBe('2026-11-11');
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

  describe('with several reminder times', () => {
    const water = (overrides: Partial<Habit> = {}) =>
      habit({ id: 2, timesPerDay: 3, reminderTime: '08:00', reminderTimes: ['08:00', '13:00', '20:00'], ...overrides });
    const todayAt = (plan: ReturnType<typeof planReminders>) =>
      plan.filter((r) => r.date === '2026-11-02').map((r) => new Date(r.at).toISOString());

    it("plans every time still ahead while the day is open, and none of today's once it is done", () => {
      const partial = { date: '2026-11-02', state: 'partial' as const, completed: null, count: 1 };
      const done = { date: '2026-11-02', state: 'done' as const, completed: true, count: 3 };

      const plan = planReminders([water({ today: partial })], 'Europe/Berlin', berlinMorning);

      expect(todayAt(plan)).toEqual(['2026-11-02T12:00:00.000Z', '2026-11-02T19:00:00.000Z']);
      expect(plan.filter((r) => r.date === '2026-11-03').map((r) => r.time)).toEqual(['08:00', '13:00', '20:00']);
      expect(plan).toHaveLength(2 + 3 * (planDays - 1));
      expect(todayAt(planReminders([water({ today: done })], 'Europe/Berlin', berlinMorning))).toEqual([]);
    });

    it('keeps each reminder id when other habits change, with a different id per time', () => {
      const alone = planReminders([water()], 'Europe/Berlin', berlinMorning);
      const withOthers = planReminders([habit({ id: 1, reminderTime: '07:00' }), water()], 'Europe/Berlin', berlinMorning);
      const ids = (plan: ReturnType<typeof planReminders>) =>
        plan.filter((r) => r.habitId === 2).map((r) => [r.date, r.time, r.id]);

      expect(ids(withOthers)).toEqual(ids(alone));
      expect(new Set(alone.map((r) => r.id)).size).toBe(alone.length);
      expect(alone[0].id).toBe(reminderId({ habitId: 2, date: '2026-11-02', time: '13:00' }));
    });

    it('skips a second reminder when the next reminder time comes first', () => {
      const plan = planReminders(
        [water({ timesPerDay: 2, reminderTimes: ['13:00', '13:20'] })],
        'Europe/Berlin',
        berlinMorning,
        [],
        30,
      );

      expect(todayAt(plan)).toEqual([
        '2026-11-02T12:00:00.000Z',
        '2026-11-02T12:20:00.000Z',
        '2026-11-02T12:50:00.000Z',
      ]);
      expect(plan.filter((r) => r.date === '2026-11-02').map((r) => r.second ?? false)).toEqual([false, false, true]);
    });
  });
});
