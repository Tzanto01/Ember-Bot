import { describe, expect, it } from 'vitest';
import type { DayState, LocalDateString } from '../models';
import { dayStats, habitDays, habitStartDate, habitView, isScheduledOn, localToday, pause, retarget, weeklySummary, writeDay } from './rules';
import type { LocalData, LocalHabit, LocalLog } from './types';

const TODAY = '2026-11-11'; // a Wednesday
const LONG_AGO = '2026-01-01T00:00:00Z';

const shift = (date: LocalDateString, n: number): LocalDateString => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const ago = (n: number) => shift(TODAY, -n);

function habit(over: Partial<LocalHabit> = {}): LocalHabit {
  return {
    id: 1,
    name: 'Water',
    frequency: 'daily',
    weeklyTarget: null,
    days: null,
    timesPerDay: 1,
    reminderTime: null,
    reminderChannels: [],
    pausedFrom: null,
    pausedUntil: null,
    createdAt: LONG_AGO,
    routineId: null,
    routinePosition: null,
    ...over,
  };
}

const done = (...agos: number[]): LocalLog[] => agos.map((n) => ({ habitId: 1, date: ago(n), completed: true, count: 1 }));
const missed = (...agos: number[]): LocalLog[] => agos.map((n) => ({ habitId: 1, date: ago(n), completed: false, count: 0 }));

function data(
  habits: LocalHabit[],
  logs: LocalLog[] = [],
  opts: { grace?: number; lowDays?: LocalDateString[]; timezone?: string } = {},
): LocalData {
  return {
    profile: {
      userId: 'u',
      timezone: opts.timezone ?? 'UTC',
      graceDaysPerWeek: opts.grace ?? 1,
      theme: null,
      createdAt: LONG_AGO,
      lastBackupAt: null,
      backupReminderSnoozedUntil: null,
      nextIds: { habit: 99, routine: 1, mood: 1 },
    },
    habits,
    logs,
    lowDays: opts.lowDays ?? [],
    routines: [],
    moods: [],
    notes: [],
  };
}

const stats = (h: LocalHabit, logs: LocalLog[], opts: Parameters<typeof data>[2] = {}, today = TODAY) =>
  habitView(data([h], logs, opts), h.id, today).stats;

const dayOf = (h: LocalHabit, logs: LocalLog[], date: LocalDateString, opts: Parameters<typeof data>[2] = {}) =>
  habitDays(data([h], logs, opts), h.id, date, date, TODAY)[0];

describe('localToday', () => {
  it('is the calendar day in the zone, ahead of UTC', () => {
    expect(localToday('Pacific/Auckland', new Date('2026-11-10T12:30:00Z'))).toBe('2026-11-11');
  });

  it('is the calendar day in the zone, behind UTC', () => {
    expect(localToday('America/Los_Angeles', new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-10');
  });
});

describe('habitStartDate', () => {
  const createdAt = '2026-11-10T23:30:00Z';

  it.each([
    ['Europe/Berlin', '2026-11-11'],
    ['America/New_York', '2026-11-10'],
    ['UTC', '2026-11-10'],
  ])('is the creation instant as a day in %s', (zone, expected) => {
    expect(habitStartDate(habit({ createdAt }), zone)).toBe(expected);
  });
});

describe('isScheduledOn', () => {
  const mwf = habit({ frequency: 'weekdays', days: ['mon', 'wed'] });

  it('follows the weekdays of a weekdays habit', () => {
    expect([ago(2), ago(1), ago(0), ago(-4)].map((d) => isScheduledOn(mwf, d))).toEqual([true, false, true, false]);
  });

  it('is every day for daily and weekly habits', () => {
    expect(isScheduledOn(habit(), ago(1))).toBe(true);
    expect(isScheduledOn(habit({ frequency: 'weekly', weeklyTarget: 3 }), ago(1))).toBe(true);
  });
});

describe('habitDays day states', () => {
  type Case = [string, Partial<LocalHabit>, LocalLog[], LocalDateString[], number, DayState, boolean | null, number];
  const cases: Case[] = [
    ['before the start day, beating low day and log', { createdAt: '2026-11-09T10:00:00Z' }, done(3), [ago(3)], 3, 'beforestart', true, 1],
    ['logged done', {}, done(3), [], 3, 'done', true, 1],
    ['a closed day without a log', {}, [], [], 3, 'notdone', null, 0],
    ['the day before yesterday, explicitly not done', {}, missed(2), [], 2, 'notdone', false, 0],
    ['today without a log', {}, [], [], 0, 'pending', null, 0],
    ['yesterday without a log', {}, [], [], 1, 'pending', null, 0],
    ['yesterday explicitly not done', {}, missed(1), [], 1, 'pending', false, 0],
    ['a low day', {}, [], [ago(3)], 3, 'lowday', null, 0],
    ['a low day that was also done', {}, done(3), [ago(3)], 3, 'lowday', true, 1],
    ['inside the paused range, beating low day and log', { pausedFrom: ago(5), pausedUntil: ago(2) }, done(3), [ago(3)], 3, 'paused', true, 1],
    ['the day before the pause', { pausedFrom: ago(5), pausedUntil: ago(2) }, [], [], 6, 'notdone', null, 0],
    ['a pause without a start covers every day up to its end', { pausedUntil: ago(-1) }, [], [], 20, 'paused', null, 0],
    ['an unlogged offday, closed', { frequency: 'weekdays', days: ['mon'] }, [], [], 1, 'offday', null, 0],
    ['an unlogged offday, today', { frequency: 'weekdays', days: ['mon'] }, [], [], 0, 'offday', null, 0],
    ['an unlogged scheduled day, closed', { frequency: 'weekdays', days: ['mon'] }, [], [], 2, 'notdone', null, 0],
    ['a checked-in offday', { frequency: 'weekdays', days: ['mon'] }, done(1), [], 1, 'done', true, 1],
    ['some but not all check-ins', { timesPerDay: 3 }, [{ habitId: 1, date: ago(3), completed: false, count: 2 }], [], 3, 'partial', null, 2],
    ['some check-ins on an offday', { frequency: 'weekdays', days: ['mon'], timesPerDay: 3 }, [{ habitId: 1, date: ago(1), completed: false, count: 1 }], [], 1, 'partial', null, 1],
    ['a weekly habit day without a log, closed', { frequency: 'weekly', weeklyTarget: 3 }, [], [], 3, 'notdone', null, 0],
  ];

  it.each(cases)('%s', (_name, over, logs, lowDays, agoN, state, completed, count) => {
    expect(dayOf(habit(over), logs, ago(agoN), { lowDays })).toEqual({ date: ago(agoN), state, completed, count });
  });

  it('lists the range oldest first and inclusive', () => {
    const days = habitDays(data([habit()], done(2)), 1, ago(3), ago(1), TODAY);
    expect(days.map((d) => [d.date, d.state])).toEqual([
      [ago(3), 'notdone'],
      [ago(2), 'done'],
      [ago(1), 'pending'],
    ]);
  });

  it('starts the habit on its local day in a zone ahead of UTC', () => {
    const h = habit({ createdAt: '2026-11-10T23:30:00Z' });
    const opts = { timezone: 'Europe/Berlin' };
    expect(dayOf(h, [], ago(1), opts).state).toBe('beforestart');
    expect(dayOf(h, [], ago(0), opts).state).toBe('pending');
    expect(dayOf(h, [], ago(1)).state).toBe('pending');
  });
});

describe('streak and grace days', () => {
  // Core ConsecutiveStreakTests / StreakTests
  it.each([
    ['no logs', [], 0, 0, 0],
    ['five days in a row', [0, 1, 2, 3, 4], 0, 5, 0],
    ['today not checked in yet', [1, 2], 0, 2, 0],
    ['yesterday not logged yet uses no grace', [0, 2, 3], 0, 3, 0],
    ['yesterday and today open', [2, 3], 0, 2, 0],
    ['the day before yesterday is closed', [3, 4], 0, 0, 0],
    ['one closed gap, one grace day', [0, 1, 3, 4], 1, 4, 1],
    ['one closed gap, no grace', [0, 1, 3, 4], 0, 2, 0],
    ['two gaps within a week, one grace day', [0, 1, 4, 5], 1, 2, 1],
    ['two gaps, two grace days', [0, 1, 4, 5], 2, 4, 2],
    ['no gap uses no grace', [0, 1, 2], 2, 3, 0],
    ['gaps seven days apart are in separate weeks', [0, 1, 3, 4, 5, 6, 7, 8, 10, 11], 1, 10, 2],
    ['gaps six days apart share a week', [0, 1, 3, 4, 5, 6, 7, 9, 10], 1, 7, 1],
  ])('%s', (_name, doneAgos, grace, streak, graceUsed) => {
    const s = stats(habit(), done(...doneAgos), { grace });
    expect([s.streak, s.graceUsed]).toEqual([streak, graceUsed]);
  });

  it('an explicitly not-done yesterday stays open until it closes', () => {
    const logs = [...missed(1), ...done(2, 3)];
    expect(stats(habit(), logs, { grace: 0 }).streak).toBe(2);
    expect(stats(habit(), logs, { grace: 0 }, shift(TODAY, 1)).streak).toBe(0);
  });

  it('a partial day counts as not done', () => {
    const h = habit({ timesPerDay: 2 });
    const logs: LocalLog[] = [
      { habitId: 1, date: ago(2), completed: false, count: 1 },
      { habitId: 1, date: ago(0), completed: true, count: 2 },
      { habitId: 1, date: ago(1), completed: true, count: 2 },
      { habitId: 1, date: ago(3), completed: true, count: 2 },
    ];
    expect(stats(h, logs, { grace: 0 }).streak).toBe(2);
  });

  it('low days neither break nor extend the streak', () => {
    const s = stats(habit(), done(0, 1, 3, 4), { grace: 0, lowDays: [ago(2)] });
    expect([s.streak, s.graceUsed]).toEqual([4, 0]);
  });

  it('paused days are skipped, even when checked in, without using grace', () => {
    const s = stats(habit({ pausedFrom: ago(3), pausedUntil: ago(1) }), done(0, 2, 4, 5), { grace: 0 });
    expect([s.streak, s.graceUsed]).toEqual([3, 0]);
  });

  it('a pause with no start date protects every earlier day', () => {
    const s = stats(habit({ pausedUntil: ago(1) }), done(0, 2, 3), { grace: 0 });
    expect(s.streak).toBe(1);
  });

  describe('Monday to Friday habit', () => {
    const weekdaysHabit = habit({ frequency: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] });

    it('steps over unchecked offdays without grace', () => {
      const s = stats(weekdaysHabit, done(0, 1, 2, 5, 6), { grace: 0 });
      expect([s.streak, s.graceUsed]).toEqual([5, 0]);
    });

    it('a checked-in offday extends the streak', () => {
      expect(stats(weekdaysHabit, done(0, 1, 2, 4, 5, 6), { grace: 0 }).streak).toBe(6);
    });

    it('a missed scheduled day breaks it without grace and is forgiven with grace', () => {
      expect(stats(weekdaysHabit, done(0, 1, 2, 6), { grace: 0 }).streak).toBe(3);
      const s = stats(weekdaysHabit, done(0, 1, 2, 6), { grace: 1 });
      expect([s.streak, s.graceUsed]).toEqual([4, 1]);
    });
  });

  it('a gap on the Core switchover day (2026-10-11) is covered', () => {
    const logs: LocalLog[] = ['2026-10-12', '2026-10-10', '2026-10-09'].map((date) => ({ habitId: 1, date, completed: true, count: 1 }));
    expect(habitView(data([habit()], logs, { grace: 0 }), 1, '2026-10-12').stats.streak).toBe(3);
  });

  it('a gap on another day near the switchover day still breaks', () => {
    const logs: LocalLog[] = ['2026-10-14', '2026-10-13', '2026-10-11', '2026-10-10'].map((date) => ({ habitId: 1, date, completed: true, count: 1 }));
    expect(habitView(data([habit()], logs, { grace: 0 }), 1, '2026-10-14').stats.streak).toBe(2);
  });
});

describe('best streak', () => {
  it.each([
    ['an older run longer than the current one', [0, 1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 0, 10, 2],
    ['never below the current streak', [0, 1, 2], 0, 3, 3],
    ['an older run with a forgiven gap', [0, 12, 13, 15, 16, 17], 1, 5, 1],
  ])('%s', (_name, doneAgos, grace, best, streak) => {
    const s = stats(habit(), done(...doneAgos), { grace });
    expect([s.bestStreak, s.streak]).toEqual([best, streak]);
  });
});

describe('last7', () => {
  it('counts done days in the seven days ending today', () => {
    expect(stats(habit(), done(0, 3, 6, 7)).last7).toBe(3);
  });

  it('counts low days once, only where the habit is scheduled, started and not paused', () => {
    const h = habit({ frequency: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    expect(stats(h, done(0), { lowDays: [ago(1)] }).last7).toBe(2);
    expect(stats(h, done(0, 1), { lowDays: [ago(1)] }).last7).toBe(2);
    expect(stats(h, done(0), { lowDays: [ago(3)] }).last7).toBe(1);
    expect(stats(habit({ pausedFrom: ago(3), pausedUntil: ago(2) }), done(0), { lowDays: [ago(2)] }).last7).toBe(1);
    expect(stats(habit({ createdAt: '2026-11-09T10:00:00Z' }), done(0), { lowDays: [ago(3), ago(1)] }).last7).toBe(2);
  });

  it('counts a checked-in offday but not a partial day', () => {
    const h = habit({ frequency: 'weekdays', days: ['mon'], timesPerDay: 2 });
    const logs: LocalLog[] = [
      { habitId: 1, date: ago(1), completed: true, count: 2 },
      { habitId: 1, date: ago(2), completed: false, count: 1 },
    ];
    expect(stats(h, logs).last7).toBe(1);
  });
});

describe('weekly habits', () => {
  const weekly = habit({ frequency: 'weekly', weeklyTarget: 3 });

  it('report week progress for the Monday to Sunday week and no streaks', () => {
    const s = stats(weekly, [...done(0, 2, 3), ...missed(1)]);
    expect(s).toMatchObject({ streak: null, graceUsed: null, bestStreak: null, week: { done: 2, target: 3 } });
  });

  it('the week ends on Sunday', () => {
    const logs: LocalLog[] = ['2026-11-08', '2026-11-09'].map((date) => ({ habitId: 1, date, completed: true, count: 1 }));
    expect(stats(weekly, logs, {}, '2026-11-15').week).toEqual({ done: 1, target: 3 });
  });

  it('count last7 like daily habits', () => {
    expect(stats(weekly, done(0, 3, 8)).last7).toBe(2);
  });

  it('daily habits have no week', () => {
    expect(stats(habit(), done(0)).week).toBeNull();
  });
});

describe('habitView', () => {
  it('maps a paused weekdays habit to the API shape', () => {
    const h = habit({
      frequency: 'weekdays',
      days: ['mon', 'wed'],
      timesPerDay: 2,
      reminderTime: '09:30',
      routineId: 4,
      pausedFrom: ago(1),
      pausedUntil: ago(-2),
      createdAt: '2026-11-10T23:30:00Z',
    });
    expect(habitView(data([h], [], { timezone: 'Europe/Berlin' }), 1, TODAY)).toMatchObject({
      id: 1,
      name: 'Water',
      frequency: 'weekdays',
      weeklyTarget: null,
      days: ['mon', 'wed'],
      timesPerDay: 2,
      routineId: 4,
      reminderTime: '09:30',
      pausedFrom: ago(1),
      pausedUntil: ago(-2),
      pausedToday: true,
      createdAt: '2026-11-10T23:30:00Z',
      startDate: '2026-11-11',
      today: { date: TODAY, state: 'paused', completed: null, count: 0 },
    });
  });

  it('a pause that ended is not paused today', () => {
    expect(habitView(data([habit({ pausedFrom: ago(5), pausedUntil: ago(1) })]), 1, TODAY).pausedToday).toBe(false);
  });
});

describe('writeDay', () => {
  const three = habit({ timesPerDay: 3 });
  const write = (logs: LocalLog[], edit: Parameters<typeof writeDay>[3], h = three) =>
    writeDay(data([h], logs), h.id, ago(1), edit).filter((l) => l.date === ago(1));

  it('completed true fills the day to the target', () => {
    expect(write([], { completed: true })).toEqual([{ habitId: 1, date: ago(1), completed: true, count: 3 }]);
  });

  it('completed false records an explicit not-done day, replacing a done one', () => {
    const existing: LocalLog[] = [{ habitId: 1, date: ago(1), completed: true, count: 3 }];
    expect(write(existing, { completed: false })).toEqual([{ habitId: 1, date: ago(1), completed: false, count: 0 }]);
  });

  it('completed null removes the log', () => {
    expect(write([{ habitId: 1, date: ago(1), completed: true, count: 3 }], { completed: null })).toEqual([]);
  });

  it('a count below the target is partial, at the target is done', () => {
    expect(write([], { count: 2 })).toEqual([{ habitId: 1, date: ago(1), completed: false, count: 2 }]);
    expect(write([], { count: 3 })).toEqual([{ habitId: 1, date: ago(1), completed: true, count: 3 }]);
  });

  it('a done day stays done while the count is not lowered', () => {
    const raised = habit({ timesPerDay: 4 });
    const existing: LocalLog[] = [{ habitId: 1, date: ago(1), completed: true, count: 2 }];
    expect(write(existing, { count: 3 }, raised)).toEqual([{ habitId: 1, date: ago(1), completed: true, count: 3 }]);
    expect(write(existing, { count: 2 }, raised)).toEqual([{ habitId: 1, date: ago(1), completed: true, count: 2 }]);
    expect(write(existing, { count: 1 }, raised)).toEqual([{ habitId: 1, date: ago(1), completed: false, count: 1 }]);
    expect(write(existing, { count: 0 }, raised)).toEqual([{ habitId: 1, date: ago(1), completed: false, count: 0 }]);
  });

  it('returns a new array and leaves other days and habits alone', () => {
    const other: LocalLog = { habitId: 2, date: ago(1), completed: true, count: 1 };
    const sameHabit: LocalLog = { habitId: 1, date: ago(2), completed: true, count: 3 };
    const input = data([three, habit({ id: 2 })], [other, sameHabit]);
    const out = writeDay(input, 1, ago(1), { completed: true });
    expect(out).toHaveLength(3);
    expect(out).toEqual(expect.arrayContaining([other, sameHabit]));
    expect(input.logs).toEqual([other, sameHabit]);
  });
});

describe('retarget', () => {
  const log = (n: number, count: number, completed: boolean, habitId = 1): LocalLog => ({ habitId, date: ago(n), completed, count });
  const byDay = (logs: LocalLog[]) => Object.fromEntries(logs.filter((l) => l.habitId === 1).map((l) => [l.date, l.completed]));

  it('a lowered target makes past days that reach it done and recomputes today', () => {
    const input = data([habit({ timesPerDay: 3 })], [log(5, 3, true), log(4, 2, false), log(3, 1, false), log(0, 2, false)]);
    expect(byDay(retarget(input, 1, 2, TODAY))).toEqual({ [ago(5)]: true, [ago(4)]: true, [ago(3)]: false, [ago(0)]: true });
  });

  it('a raised target never takes a done past day away but recomputes today', () => {
    const input = data([habit({ timesPerDay: 2 })], [log(3, 2, true), log(0, 2, true), log(1, 4, true)]);
    expect(byDay(retarget(input, 1, 4, TODAY))).toEqual({ [ago(3)]: true, [ago(1)]: true, [ago(0)]: false });
  });

  it('keeps counts and other habits unchanged and does not modify its input', () => {
    const logs = [log(4, 2, false), log(4, 1, false, 2)];
    const input = data([habit({ timesPerDay: 3 }), habit({ id: 2, timesPerDay: 3 })], logs);
    const out = retarget(input, 1, 1, TODAY);
    expect(out.map((l) => [l.habitId, l.count, l.completed])).toEqual([[1, 2, true], [2, 1, false]]);
    expect(input.logs[0].completed).toBe(false);
  });
});

describe('dayStats', () => {
  const ids = (n: number, over: Partial<LocalHabit> = {}) => habit({ id: n, name: `H${n}`, ...over });
  const L = (habitId: number, n: number, completed: boolean, count: number): LocalLog => ({ habitId, date: ago(n), completed, count });

  const habits = [
    ids(1),
    ids(2, { frequency: 'weekdays', days: ['mon'] }),
    ids(3, { frequency: 'weekly', weeklyTarget: 3 }),
    ids(4, { timesPerDay: 2 }),
    ids(5, { pausedFrom: ago(2), pausedUntil: ago(0) }),
    ids(6, { createdAt: `${TODAY}T08:00:00Z` }),
  ];
  const logs = [L(1, 1, true, 1), L(2, 1, true, 1), L(3, 1, false, 0), L(4, 1, false, 1), L(5, 1, true, 1)];

  it('counts scheduled habits and done and partial check-ins, offdays and paused days included in done', () => {
    const [stat] = dayStats(data(habits, logs), ago(1), ago(1), TODAY);
    expect(stat).toEqual({ date: ago(1), scheduled: 3, done: 3, partial: 1, showedUp: true });
  });

  it('a habit becomes scheduled on its start day', () => {
    expect(dayStats(data(habits, []), ago(0), ago(0), TODAY)[0].scheduled).toBe(4);
  });

  it('low days do not change scheduled', () => {
    const [stat] = dayStats(data(habits, logs, { lowDays: [ago(1)] }), ago(1), ago(1), TODAY);
    expect(stat.scheduled).toBe(3);
  });

  it('an explicit not-done day or an empty day is not showing up', () => {
    const [a, b] = dayStats(data([ids(1), ids(3, { frequency: 'weekly', weeklyTarget: 2 })], [L(3, 3, false, 0)]), ago(3), ago(2), TODAY);
    expect(a).toEqual({ date: ago(3), scheduled: 2, done: 0, partial: 0, showedUp: false });
    expect(b).toEqual({ date: ago(2), scheduled: 2, done: 0, partial: 0, showedUp: false });
  });

  it('a checked-in offday alone is showing up', () => {
    const only = [ids(2, { frequency: 'weekdays', days: ['mon'] })];
    const [stat] = dayStats(data(only, [L(2, 1, true, 1)]), ago(1), ago(1), TODAY);
    expect(stat).toEqual({ date: ago(1), scheduled: 0, done: 1, partial: 0, showedUp: true });
  });

  it('lists the range oldest first, inclusive, and is empty when from is after to', () => {
    expect(dayStats(data(habits, logs), ago(2), ago(0), TODAY).map((s) => s.date)).toEqual([ago(2), ago(1), ago(0)]);
    expect(dayStats(data(habits, logs), ago(0), ago(2), TODAY)).toEqual([]);
  });

  it('starts habits on their local day', () => {
    const h = [ids(1, { createdAt: '2026-11-10T23:30:00Z' })];
    expect(dayStats(data(h), ago(1), ago(1), TODAY)[0].scheduled).toBe(1);
    expect(dayStats(data(h, [], { timezone: 'Europe/Berlin' }), ago(1), ago(1), TODAY)[0].scheduled).toBe(0);
  });
});

describe('weeklySummary', () => {
  // window: ago(7) to ago(1), the seven days ending yesterday
  const summary = (habits: LocalHabit[], logs: LocalLog[], opts: Parameters<typeof data>[2] = {}) =>
    weeklySummary(data(habits, logs, opts), TODAY);

  it('celebrates a perfect week', () => {
    const s = summary([habit()], done(1, 2, 3, 4, 5, 6, 7));
    expect(s).toEqual({
      totalDone: 7,
      totalPossible: 7,
      headline: 'You nailed every single check-in this week 🔥 That\'s 7/7. Incredible.',
      footer: 'You\'re on fire. Keep going.',
      habits: [{ habitId: 1, name: 'Water', done: 7, possible: 7, streak: 7 }],
    });
  });

  it('nudges gently after a week without check-ins', () => {
    const s = summary([habit()], done(0));
    expect(s.totalDone).toBe(0);
    expect(s.headline).toBe('It\'s been a quiet week — and that\'s okay. 💙\nWhenever you\'re ready, your habits are here waiting.');
    expect(s.footer).toBe('No pressure. Progress happens at its own pace.');
  });

  it('shows the rate with markdown stripped, and encourages below half', () => {
    const s = summary([habit()], done(1, 3, 5));
    expect(s.headline).toBe('This week you completed 3/7 check-ins (43%). Every one of those counts. 💪');
    expect(s.footer).toBe('Small steps still move forward. You\'ve got this.');
  });

  it('exactly half is more than half', () => {
    const s = summary([habit({ createdAt: ago(3) + 'T10:00:00Z' })], done(1));
    expect(s.habits[0]).toMatchObject({ done: 1, possible: 2 });
    expect(s.headline).toBe('This week you completed 1/2 check-ins (50%). Every one of those counts. 💪');
    expect(s.footer).toBe('More than half — that\'s a win. Keep it up.');
  });

  it('counts only the seven days ending yesterday', () => {
    expect(summary([habit()], done(0, 1, 7, 8)).totalDone).toBe(2);
  });

  it('possible excludes paused days and low days', () => {
    const h = habit({ pausedFrom: ago(6), pausedUntil: ago(5) });
    expect(summary([h], [], { lowDays: [ago(1)] }).habits[0].possible).toBe(4);
  });

  it('possible excludes offdays', () => {
    const h = habit({ frequency: 'weekdays', days: ['mon', 'tue'] });
    expect(summary([h], []).habits[0].possible).toBe(2);
  });

  it('possible is the weekly target, capped by active days, and the streak is null', () => {
    const w = habit({ frequency: 'weekly', weeklyTarget: 3 });
    expect(summary([w], done(1, 2)).habits[0]).toMatchObject({ done: 2, possible: 3, streak: null });
    const young = habit({ frequency: 'weekly', weeklyTarget: 3, createdAt: ago(2) + 'T10:00:00Z' });
    expect(summary([young], []).habits[0].possible).toBe(1);
  });

  it('never reports more done than possible, e.g. check-ins on paused days', () => {
    const h = habit({ pausedUntil: ago(1) });
    expect(summary([h], done(2, 3)).habits[0]).toMatchObject({ done: 2, possible: 2 });
  });

  it('lists habits oldest first and sums the totals', () => {
    const younger = habit({ id: 2, name: 'Walk', createdAt: '2026-02-01T00:00:00Z' });
    const older = habit({ id: 3, name: 'Read' });
    const logs: LocalLog[] = [{ habitId: 2, date: ago(1), completed: true, count: 1 }, { habitId: 3, date: ago(1), completed: true, count: 1 }];
    const s = summary([younger, older], logs);
    expect(s.habits.map((x) => x.name)).toEqual(['Read', 'Walk']);
    expect([s.totalDone, s.totalPossible]).toEqual([2, 14]);
  });
});

describe('pause', () => {
  const unpaused = habit();

  it('a new pause starts today', () => {
    expect(pause(unpaused, ago(-3), TODAY)).toEqual({ pausedFrom: TODAY, pausedUntil: ago(-3) });
  });

  it('a new pause after an earlier one ended starts today', () => {
    expect(pause(habit({ pausedFrom: ago(10), pausedUntil: ago(5) }), ago(-3), TODAY)).toEqual({ pausedFrom: TODAY, pausedUntil: ago(-3) });
  });

  it('extending a running pause keeps its start', () => {
    expect(pause(habit({ pausedFrom: ago(2), pausedUntil: ago(-1) }), ago(-5), TODAY)).toEqual({ pausedFrom: ago(2), pausedUntil: ago(-5) });
  });

  it('resuming a pause that began before today ends it yesterday', () => {
    expect(pause(habit({ pausedFrom: ago(2), pausedUntil: ago(-5) }), null, TODAY)).toEqual({ pausedFrom: ago(2), pausedUntil: ago(1) });
  });

  it('resuming a pause that began today removes it', () => {
    expect(pause(habit({ pausedFrom: TODAY, pausedUntil: ago(-5) }), null, TODAY)).toEqual({ pausedFrom: null, pausedUntil: null });
  });

  it('resuming a pause that already ended keeps its end', () => {
    expect(pause(habit({ pausedFrom: ago(10), pausedUntil: ago(5) }), null, TODAY)).toEqual({ pausedFrom: ago(10), pausedUntil: ago(5) });
  });

  it('resuming an unpaused habit leaves it unpaused', () => {
    expect(pause(unpaused, null, TODAY)).toEqual({ pausedFrom: null, pausedUntil: null });
  });

  it('after a resume the earlier days stay paused and today is open', () => {
    const resumed = { ...habit({ pausedFrom: ago(2), pausedUntil: ago(-5) }), ...pause(habit({ pausedFrom: ago(2), pausedUntil: ago(-5) }), null, TODAY) };
    const days = habitDays(data([resumed]), 1, ago(2), ago(0), TODAY);
    expect(days.map((d) => d.state)).toEqual(['paused', 'paused', 'pending']);
  });
});
