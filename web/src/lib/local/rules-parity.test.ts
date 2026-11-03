import { describe, expect, it } from 'vitest';
import fixture from '../../../../docs/contracts/fixtures/rules-v1.json';
import { dayStats, habitDays, habitView } from './rules';
import type { LocalData, LocalHabit } from './types';

type FixtureCase = (typeof fixture.cases)[number];

function toLocalData(c: FixtureCase): LocalData {
  const habits: LocalHabit[] = c.habits.map((h) => ({
    id: h.id,
    name: `Habit ${h.id}`,
    frequency: h.frequency as LocalHabit['frequency'],
    weeklyTarget: h.weeklyTarget,
    days: h.days as LocalHabit['days'],
    timesPerDay: h.timesPerDay,
    reminderTime: null,
    reminderChannels: [],
    pausedFrom: h.pausedFrom,
    pausedUntil: h.pausedUntil,
    createdAt: `${h.startDate}T12:00:00Z`,
    routineId: h.routineId,
    routinePosition: null,
  }));
  return {
    profile: {
      userId: 'u',
      timezone: c.timezone,
      graceDaysPerWeek: c.graceDaysPerWeek,
      theme: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastBackupAt: null,
      backupReminderSnoozedUntil: null,
      nextIds: { habit: 99, routine: 99, mood: 1 },
    },
    habits,
    logs: c.habits.flatMap((h) => h.logs.map((l) => ({ habitId: h.id, date: l.date, completed: l.completed, count: l.count }))),
    lowDays: c.lowDays,
    routines: c.routines.map((r) => ({ id: r.id, name: `Routine ${r.id}`, reminderTime: null, reminderChannels: [] })),
    moods: [],
    notes: [],
  };
}

describe('client rules match the Core rules fixture', () => {
  it('has all 15 cases', () => {
    expect(fixture.cases).toHaveLength(15);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const data = toLocalData(c);

    for (const h of c.habits) {
      const days = habitDays(data, h.id, c.from, c.today, c.today);
      expect(days).toEqual((c.expected.days as Record<string, unknown>)[String(h.id)]);
      expect(habitView(data, h.id, c.today).stats).toEqual((c.expected.stats as Record<string, unknown>)[String(h.id)]);
    }

    expect(dayStats(data, c.from, c.today, c.today)).toEqual(c.expected.dayStats);

    for (const r of c.routines) {
      const pending = r.habitIds.filter((id) => {
        const state = habitDays(data, id, c.today, c.today, c.today)[0].state;
        return state === 'pending' || state === 'partial';
      });
      expect(pending).toEqual((c.expected.routinePending as Record<string, number[]>)[String(r.id)]);
    }
  });
});
