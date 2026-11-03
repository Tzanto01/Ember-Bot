import { addDays, fromParts, startOfWeek, toParts, weekdayIndex } from '../local-date';
import { weekdays } from '../models';
import type { DayEntry, DayStat, DayState, Habit, HabitStats, LocalDateString, WeeklyStats } from '../models';
import type { LocalData, LocalHabit, LocalLog } from './types';

const OPEN_DAYS = 2;
const SWITCHOVER = '2026-10-11';
const DAY_MS = 86_400_000;

function dayNumber(date: LocalDateString): number {
  const { year, month, day } = toParts(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function zonedDate(instant: Date, timeZone: string): LocalDateString {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(instant);
  let found: Intl.DateTimeFormatPart[];
  try {
    found = parts(timeZone);
  } catch {
    found = parts('UTC');
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(found.find((p) => p.type === type)?.value);
  return fromParts(get('year'), get('month'), get('day'));
}

/** The current local day in `timeZone` (unknown zones fall back to UTC, as in Core `TimezoneHelper.LocalToday`). */
export function localToday(timeZone: string, now: Date = new Date()): LocalDateString {
  return zonedDate(now, timeZone);
}

/** The habit's first loggable day: the date of `createdAt` in the profile time zone (Core `StartDate`). */
export function habitStartDate(habit: LocalHabit, timeZone: string): LocalDateString {
  return zonedDate(new Date(habit.createdAt), timeZone);
}

function scheduledWeekday(habit: LocalHabit, index: number): boolean {
  return habit.frequency !== 'weekdays' || (habit.days?.includes(weekdays[index]) ?? false);
}

/** Always, unless a `weekdays` habit and the date's weekday isn't in `days` (Core `IsScheduledOn`). */
export function isScheduledOn(habit: LocalHabit, date: LocalDateString): boolean {
  return scheduledWeekday(habit, weekdayIndex(date));
}

function isPausedOn(habit: LocalHabit, date: LocalDateString): boolean {
  return habit.pausedUntil !== null && date <= habit.pausedUntil && (habit.pausedFrom === null || date >= habit.pausedFrom);
}

function isOpen(date: LocalDateString, today: LocalDateString): boolean {
  return date <= today && date > addDays(today, -OPEN_DAYS);
}

function findHabit(data: LocalData, habitId: number): LocalHabit {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) throw new Error(`No local habit ${habitId}`);
  return habit;
}

function logsOf(data: LocalData, habitId: number): Map<LocalDateString, LocalLog> {
  const logs = new Map<LocalDateString, LocalLog>();
  for (const log of data.logs) if (log.habitId === habitId) logs.set(log.date, log);
  return logs;
}

function dayOn(
  habit: LocalHabit,
  date: LocalDateString,
  today: LocalDateString,
  start: LocalDateString,
  log: LocalLog | undefined,
  lowDays: ReadonlySet<LocalDateString>,
): DayEntry {
  const partial = !!log && !log.completed && log.count > 0;
  const state: DayState =
    date < start ? 'beforestart'
    : isPausedOn(habit, date) ? 'paused'
    : lowDays.has(date) ? 'lowday'
    : log?.completed ? 'done'
    : partial ? 'partial'
    : !isScheduledOn(habit, date) ? 'offday'
    : isOpen(date, today) ? 'pending'
    : 'notdone';
  return { date, state, completed: partial ? null : (log?.completed ?? null), count: log?.count ?? 0 };
}

/** Oldest first, inclusive. Days before start are `beforestart`. */
export function habitDays(
  data: LocalData,
  habitId: number,
  from: LocalDateString,
  to: LocalDateString,
  today: LocalDateString,
): DayEntry[] {
  const habit = findHabit(data, habitId);
  const logs = logsOf(data, habitId);
  const lowDays = new Set(data.lowDays);
  const start = habitStartDate(habit, data.profile.timezone);
  const days: DayEntry[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(dayOn(habit, date, today, start, logs.get(date), lowDays));
  return days;
}

interface StreakInput {
  habit: LocalHabit;
  completed: Set<number>;
  floor: number;
  lowDays: Set<number>;
  graceDays: number;
  pausedFrom: number;
  pausedUntil: number;
  switchover: number;
}

function streakInput(habit: LocalHabit, logs: Map<LocalDateString, LocalLog>, lowDays: Iterable<LocalDateString>, graceDays: number): StreakInput {
  const completed = new Set<number>();
  let floor = Infinity;
  for (const log of logs.values()) {
    if (!log.completed) continue;
    const day = dayNumber(log.date);
    completed.add(day);
    floor = Math.min(floor, day);
  }
  return {
    habit,
    completed,
    floor,
    lowDays: new Set([...lowDays].map(dayNumber)),
    graceDays,
    pausedFrom: habit.pausedFrom === null ? -Infinity : dayNumber(habit.pausedFrom),
    pausedUntil: habit.pausedUntil === null ? -Infinity : dayNumber(habit.pausedUntil),
    switchover: dayNumber(SWITCHOVER),
  };
}

function streakEndingAt(s: StreakInput, end: number, today: number): { streak: number; graceUsed: number } {
  let streak = 0;
  const forgiven: number[] = [];
  for (let day = end; day >= s.floor; day--) {
    const done = s.completed.has(day);
    const covered =
      (day >= s.pausedFrom && day <= s.pausedUntil) ||
      s.lowDays.has(day) ||
      (!done && (day === s.switchover || !scheduledWeekday(s.habit, (((day + 3) % 7) + 7) % 7)));
    if (covered || (!done && day <= today && day > today - OPEN_DAYS)) continue;
    if (done) streak++;
    else if (forgiven.filter((g) => g - day < 7).length < s.graceDays) forgiven.push(day);
    else break;
  }
  return { streak, graceUsed: forgiven.length };
}

function consecutiveStreak(s: StreakInput, today: number): { streak: number; graceUsed: number } {
  return s.completed.size === 0 ? { streak: 0, graceUsed: 0 } : streakEndingAt(s, today, today);
}

function bestStreak(s: StreakInput, today: number): number {
  let best = 0;
  for (const end of s.completed) {
    if (end === today || (end < today && !s.completed.has(end + 1))) best = Math.max(best, streakEndingAt(s, end, today).streak);
  }
  return best;
}

function flexibleStreak(
  habit: LocalHabit,
  logs: Map<LocalDateString, LocalLog>,
  lowDays: Iterable<LocalDateString>,
  start: LocalDateString,
  today: LocalDateString,
): number {
  const cutoff = addDays(today, -6);
  const kept = new Set<LocalDateString>();
  for (const log of logs.values()) if (log.completed && log.date >= cutoff) kept.add(log.date);
  const from = start > cutoff ? start : cutoff;
  for (const d of lowDays) if (d >= from && d <= today && !isPausedOn(habit, d) && isScheduledOn(habit, d)) kept.add(d);
  return kept.size;
}

function weeklyProgress(habit: LocalHabit, logs: Map<LocalDateString, LocalLog>, today: LocalDateString): { done: number; target: number } {
  const monday = startOfWeek(today);
  const sunday = addDays(monday, 6);
  let done = 0;
  for (const log of logs.values()) if (log.completed && log.date >= monday && log.date <= sunday) done++;
  return { done, target: habit.weeklyTarget ?? 3 };
}

/** The full API `Habit` DTO (today, stats, pausedToday, startDate, routineId, reminderChannels, days, timesPerDay, …). */
export function habitView(data: LocalData, habitId: number, today: LocalDateString): Habit {
  const habit = findHabit(data, habitId);
  const logs = logsOf(data, habitId);
  const lowDays = new Set(data.lowDays);
  const start = habitStartDate(habit, data.profile.timezone);
  const last7 = flexibleStreak(habit, logs, lowDays, start, today);
  let stats: HabitStats;
  if (habit.frequency === 'weekly') {
    stats = { streak: null, graceUsed: null, bestStreak: null, last7, week: weeklyProgress(habit, logs, today) };
  } else {
    const input = streakInput(habit, logs, lowDays, data.profile.graceDaysPerWeek);
    const todayNumber = dayNumber(today);
    const { streak, graceUsed } = consecutiveStreak(input, todayNumber);
    stats = { streak, graceUsed, bestStreak: bestStreak(input, todayNumber), last7, week: null };
  }
  return {
    id: habit.id,
    name: habit.name,
    frequency: habit.frequency,
    weeklyTarget: habit.weeklyTarget,
    reminderTime: habit.reminderTime,
    pausedFrom: habit.pausedFrom,
    pausedUntil: habit.pausedUntil,
    pausedToday: isPausedOn(habit, today),
    createdAt: habit.createdAt,
    startDate: start,
    today: dayOn(habit, today, today, start, logs.get(today), lowDays),
    stats,
    reminderChannels: habit.reminderChannels,
    days: habit.frequency === 'weekdays' && habit.days ? weekdays.filter((d) => habit.days!.includes(d)) : null,
    timesPerDay: habit.timesPerDay,
    routineId: habit.routineId,
  };
}

/** Per local day across all habits (Core `DayStatsOn`): scheduled, done, partial and showedUp. */
export function dayStats(data: LocalData, from: LocalDateString, to: LocalDateString, _today: LocalDateString): DayStat[] {
  const logs = new Map<string, LocalLog>();
  for (const log of data.logs) if (log.date >= from && log.date <= to) logs.set(`${log.habitId}|${log.date}`, log);
  const habits = data.habits.map((habit) => ({ habit, start: habitStartDate(habit, data.profile.timezone) }));
  const result: DayStat[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    let scheduled = 0;
    let done = 0;
    let partial = 0;
    let showedUp = false;
    for (const { habit, start } of habits) {
      if (date >= start && !isPausedOn(habit, date) && isScheduledOn(habit, date)) scheduled++;
      const log = logs.get(`${habit.id}|${date}`);
      if (!log) continue;
      if (log.completed) done++;
      else if (log.count > 0) partial++;
      showedUp ||= log.completed || log.count > 0;
    }
    result.push({ date, scheduled, done, partial, showedUp });
  }
  return result;
}

function roundHalfEven(value: number): number {
  const rounded = Math.round(value);
  return rounded - value === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}

function toneLines(totalDone: number, totalPossible: number): { headline: string; footer: string } {
  if (totalDone === 0) {
    return {
      headline: "It's been a quiet week — and that's okay. 💙\nWhenever you're ready, your habits are here waiting.",
      footer: 'No pressure. Progress happens at its own pace.',
    };
  }
  if (totalDone >= totalPossible) {
    return {
      headline: `You nailed every single check-in this week 🔥 That's ${totalDone}/${Math.max(totalPossible, totalDone)}. Incredible.`,
      footer: "You're on fire. Keep going.",
    };
  }
  const pct = roundHalfEven((100 * totalDone) / totalPossible);
  return {
    headline: `This week you completed **${totalDone}/${totalPossible}** check-ins (${pct}%). Every one of those counts. 💪`,
    footer: pct >= 50 ? "More than half — that's a win. Keep it up." : "Small steps still move forward. You've got this.",
  };
}

function plainText(discordMarkdown: string): string {
  return discordMarkdown.replace(/\*\*|__|~~|\|\||`/g, '');
}

/** `GET /api/stats/weekly`: the 7 days ending yesterday (Core `WeeklySummaryService`), Discord markdown stripped. */
export function weeklySummary(data: LocalData, today: LocalDateString): WeeklyStats {
  const weekEnd = addDays(today, -1);
  const from = addDays(weekEnd, -6);
  const lowDays = new Set(data.lowDays);
  const todayNumber = dayNumber(today);
  const habits = [...data.habits]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((habit) => {
      const logs = logsOf(data, habit.id);
      const start = habitStartDate(habit, data.profile.timezone);
      let done = 0;
      for (const log of logs.values()) if (log.completed && log.date >= from && log.date <= weekEnd) done++;
      let activeDays = 0;
      for (let d = from; d <= weekEnd; d = addDays(d, 1)) {
        if (start < d && isScheduledOn(habit, d) && !isPausedOn(habit, d) && !lowDays.has(d)) activeDays++;
      }
      const possible = Math.max(habit.frequency === 'weekly' ? Math.min(habit.weeklyTarget ?? 3, activeDays) : activeDays, done);
      const streak =
        habit.frequency === 'weekly'
          ? null
          : consecutiveStreak(streakInput(habit, logs, lowDays, data.profile.graceDaysPerWeek), todayNumber).streak;
      return { habitId: habit.id, name: habit.name, done, possible, streak };
    });
  const totalDone = habits.reduce((sum, h) => sum + h.done, 0);
  const totalPossible = habits.reduce((sum, h) => sum + h.possible, 0);
  const { headline, footer } = toneLines(totalDone, totalPossible);
  return { totalDone, totalPossible, headline: plainText(headline), footer: plainText(footer), habits };
}

/** The logs array after one day edit: `{completed:true}` sets count = timesPerDay, `{completed:false}` count 0 and explicitly not done, `{completed:null}` clears (removes the log), `{count}` absolute (0…timesPerDay; completed = count >= timesPerDay at write time). Validation of ranges is the caller's. */
export function writeDay(
  data: LocalData,
  habitId: number,
  date: LocalDateString,
  edit: { completed: boolean | null } | { count: number },
): LocalLog[] {
  const index = data.logs.findIndex((l) => l.habitId === habitId && l.date === date);
  if ('completed' in edit && edit.completed === null) return index < 0 ? data.logs : data.logs.filter((_, i) => i !== index);
  const target = findHabit(data, habitId).timesPerDay;
  const count = 'count' in edit ? edit.count : edit.completed ? target : 0;
  const existing = index < 0 ? undefined : data.logs[index];
  const completed = count >= target || (!!existing?.completed && count > 0 && count >= existing.count);
  const log: LocalLog = { habitId, date, completed, count };
  return index < 0 ? [...data.logs, log] : data.logs.map((l, i) => (i === index ? log : l));
}

/** The logs array after the habit's timesPerDay changes to `timesPerDay` (only today's log is recomputed; done days stay done). */
export function retarget(data: LocalData, habitId: number, timesPerDay: number, today: LocalDateString): LocalLog[] {
  return data.logs.map((l) =>
    l.habitId === habitId && (l.date === today || l.count >= timesPerDay) ? { ...l, completed: l.count >= timesPerDay } : l,
  );
}

/** The pause fields after `POST /api/habits/{id}/pause { until }` (`until` null resumes), per Core PauseHabitAsync. */
export function pause(
  habit: LocalHabit,
  until: LocalDateString | null,
  today: LocalDateString,
): Pick<LocalHabit, 'pausedFrom' | 'pausedUntil'> {
  if (until !== null) return { pausedFrom: isPausedOn(habit, today) ? habit.pausedFrom : today, pausedUntil: until };
  if (habit.pausedUntil !== null && (habit.pausedFrom === null || habit.pausedFrom < today)) {
    return { pausedFrom: habit.pausedFrom, pausedUntil: habit.pausedUntil < today ? habit.pausedUntil : addDays(today, -1) };
  }
  return { pausedFrom: null, pausedUntil: null };
}
