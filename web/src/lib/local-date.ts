import type { LocalDateString } from './models';

/*
 * Calendar maths on `yyyy-MM-dd` strings. Everything runs in UTC on purpose, so the browser's
 * own timezone never shifts a day. "Today" always comes from `me.localToday`, never from `new Date()`.
 * Plain string comparison orders `yyyy-MM-dd` values correctly (`a < b`).
 */

const DAY_MS = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Year, month (1–12) and day of a local date. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** True when `value` is a real calendar day in `yyyy-MM-dd` form. */
export function isLocalDate(value: string): boolean {
  const match = PATTERN.exec(value);
  if (!match) return false;
  return fromUtc(Date.UTC(+match[1], +match[2] - 1, +match[3])) === value;
}

/** Splits `yyyy-MM-dd` into numbers. Throws on malformed input. */
export function toParts(date: LocalDateString): DateParts {
  const match = PATTERN.exec(date);
  if (!match) throw new Error(`Not a yyyy-MM-dd date: ${date}`);
  return { year: +match[1], month: +match[2], day: +match[3] };
}

/** Builds `yyyy-MM-dd` from numbers (month 1–12). Out-of-range values roll over, like `Date.UTC`. */
export function fromParts(year: number, month: number, day: number): LocalDateString {
  return fromUtc(Date.UTC(year, month - 1, day));
}

function toUtc(date: LocalDateString): number {
  const { year, month, day } = toParts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): LocalDateString {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date` plus `days` (negative goes back). */
export function addDays(date: LocalDateString, days: number): LocalDateString {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: LocalDateString, to: LocalDateString): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Day of the week with Monday = 0 … Sunday = 6. */
export function weekdayIndex(date: LocalDateString): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `date`. */
export function startOfWeek(date: LocalDateString): LocalDateString {
  return addDays(date, -weekdayIndex(date));
}

/** The seven days (Monday first) of the week containing `date`. */
export function weekDays(date: LocalDateString): LocalDateString[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The first day of the month containing `date`. */
export function startOfMonth(date: LocalDateString): LocalDateString {
  const { year, month } = toParts(date);
  return fromParts(year, month, 1);
}

/** The first day of the month `months` away from the month containing `date`. */
export function addMonths(date: LocalDateString, months: number): LocalDateString {
  const { year, month } = toParts(date);
  return fromParts(year, month + months, 1);
}

/** True when both dates fall in the same calendar month. */
export function isSameMonth(a: LocalDateString, b: LocalDateString): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Monday-start weeks covering the month that contains `date`, each a row of 7 dates.
 * Leading and trailing days belong to the neighbouring months; check them with `isSameMonth`.
 */
export function monthWeeks(date: LocalDateString): LocalDateString[][] {
  const first = startOfMonth(date);
  const last = addDays(addMonths(date, 1), -1);
  const weeks: LocalDateString[][] = [];
  for (let monday = startOfWeek(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(weekDays(monday));
  }
  return weeks;
}

/** Formats a local date for display, for example `formatDate('2026-11-01', { weekday: 'short', day: 'numeric', month: 'short' })`. */
export function formatDate(
  date: LocalDateString,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(toUtc(date));
}

/** Month heading such as "November 2026". */
export function monthLabel(date: LocalDateString, locale?: string): string {
  return formatDate(date, { month: 'long', year: 'numeric' }, locale);
}

/** Weekday names, Monday first, for grid headers. */
export function weekdayLabels(
  locale?: string,
  style: 'narrow' | 'short' | 'long' = 'short',
): string[] {
  return weekDays('2026-11-02').map((d) => formatDate(d, { weekday: style }, locale));
}

/** The browser's IANA zone, for suggesting a timezone in settings (never for data). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** True when the runtime knows `zone` as an IANA timezone. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Display label such as "Europe/Berlin (UTC+01:00)", using the offset at `at` (default now). */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    const offset = !name || name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
    return `${zone} (${offset})`;
  } catch {
    return zone;
  }
}
