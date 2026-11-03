import { moodLook, type MoodLook } from '@/components/journal/moods';
import { dayStateWords } from '@/lib/calendar';
import { addDays, startOfWeek, toParts } from '@/lib/local-date';
import type { DayEntry, DayNote, DayStat, LocalDateString, OwnMood } from '@/lib/models';

/** Fill of a cell: `0` empty, `1`–`3` more showing up; the rest are the gentle single-habit states. */
export type YearTone = 0 | 1 | 2 | 3 | 'lowday' | 'paused' | 'offday';

/** One day of the year grid. */
export interface YearDay {
  date: LocalDateString;
  tone: YearTone;
  /** Any check-in that day. */
  showedUp: boolean;
  /** Plain wording such as "you showed up, 2 of 3 done". Never "missed". */
  words: string;
  mood: MoodLook | null;
}

/** Number of week columns in the grid. */
export const yearWeeks = 52;

/** The first day of the grid: the Monday 51 weeks before this week, so the range stays within 366 days. */
export function yearStart(today: LocalDateString): LocalDateString {
  return addDays(startOfWeek(today), -(yearWeeks - 1) * 7);
}

function moodsByDate(notes: readonly DayNote[], own: readonly OwnMood[]): Map<LocalDateString, MoodLook> {
  const map = new Map<LocalDateString, MoodLook>();
  for (const note of notes) if (note.mood) map.set(note.date, moodLook(note.mood, own));
  return map;
}

/** Days across all habits from `GET /api/stats/days`, keyed by date. */
export function daysFromStats(
  stats: readonly DayStat[],
  notes: readonly DayNote[],
  own: readonly OwnMood[],
): Map<LocalDateString, YearDay> {
  const moods = moodsByDate(notes, own);
  const map = new Map<LocalDateString, YearDay>();
  for (const stat of stats) {
    let tone: YearTone = 0;
    let words: string;
    if (stat.showedUp) {
      const share = stat.scheduled > 0 ? stat.done / stat.scheduled : 0.5;
      tone = share >= 1 ? 3 : share >= 0.5 ? 2 : 1;
      words =
        stat.scheduled > 0
          ? `you showed up, ${stat.done} of ${stat.scheduled} done${stat.partial ? `, ${stat.partial} partly` : ''}`
          : 'you showed up';
    } else {
      words = stat.scheduled > 0 ? 'no check-ins' : 'nothing planned';
    }
    map.set(stat.date, { date: stat.date, tone, showedUp: stat.showedUp, words, mood: moods.get(stat.date) ?? null });
  }
  for (const [date, mood] of moods) {
    if (!map.has(date)) map.set(date, { date, tone: 0, showedUp: false, words: 'nothing recorded', mood });
  }
  return map;
}

const toneOf: Partial<Record<DayEntry['state'], YearTone>> = {
  done: 3,
  partial: 2,
  lowday: 'lowday',
  paused: 'paused',
  offday: 'offday',
};

/** Days of one habit from `GET /api/habits/{id}/days`, keyed by date. */
export function daysFromEntries(
  entries: readonly DayEntry[],
  notes: readonly DayNote[],
  own: readonly OwnMood[],
): Map<LocalDateString, YearDay> {
  const moods = moodsByDate(notes, own);
  const map = new Map<LocalDateString, YearDay>();
  for (const entry of entries) {
    if (entry.state === 'beforestart') continue;
    map.set(entry.date, {
      date: entry.date,
      tone: toneOf[entry.state] ?? 0,
      showedUp: entry.state === 'done' || entry.state === 'partial',
      words: dayStateWords[entry.state],
      mood: moods.get(entry.date) ?? null,
    });
  }
  for (const [date, mood] of moods) {
    if (!map.has(date)) map.set(date, { date, tone: 0, showedUp: false, words: 'nothing recorded', mood });
  }
  return map;
}

/** Days showed up in the last `window` days ending `today`, counting only days from `first` on. */
export function showedUpRecently(
  days: ReadonlyMap<LocalDateString, YearDay>,
  today: LocalDateString,
  first: LocalDateString,
  window = 30,
): { showed: number; of: number } {
  let showed = 0;
  let of = 0;
  for (let i = 0; i < window; i++) {
    const date = addDays(today, -i);
    if (date < first) break;
    of++;
    if (days.get(date)?.showedUp) showed++;
  }
  return { showed, of };
}

/** Days showed up per calendar year, newest year first. */
export function showedUpPerYear(days: ReadonlyMap<LocalDateString, YearDay>): { year: number; days: number }[] {
  const counts = new Map<number, number>();
  for (const day of days.values()) {
    if (day.showedUp) counts.set(toParts(day.date).year, (counts.get(toParts(day.date).year) ?? 0) + 1);
  }
  return [...counts].map(([year, count]) => ({ year, days: count })).sort((a, b) => b.year - a.year);
}
