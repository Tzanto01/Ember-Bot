import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  isLocalDate,
  isSameMonth,
  isValidTimeZone,
  monthWeeks,
  timeZoneLabel,
  weekdayIndex,
} from './local-date';

describe('local-date', () => {
  describe('monthWeeks', () => {
    it('starts on Monday, has rows of 7 and covers every day of the month', () => {
      const weeks = monthWeeks('2026-11-15');
      expect(weeks.every((w) => w.length === 7)).toBe(true);
      expect(weeks.every((w) => weekdayIndex(w[0]) === 0)).toBe(true);
      const inMonth = weeks.flat().filter((d) => isSameMonth(d, '2026-11-01'));
      expect(inMonth).toHaveLength(30);
      expect(weeks[0][0]).toBe('2026-10-26');
      expect(weeks.at(-1)![6]).toBe('2026-12-06');
    });

    it('does not add a leading row when the month begins on a Monday', () => {
      const weeks = monthWeeks('2026-06-10');
      expect(weeks[0][0]).toBe('2026-06-01');
      expect(weeks).toHaveLength(5);
      expect(weeks.at(-1)![6]).toBe('2026-07-05');
    });

    it('adds a sixth row when a 31-day month starts late in the week', () => {
      const weeks = monthWeeks('2026-08-01');
      expect(weeks).toHaveLength(6);
      expect(weeks.flat()).toContain('2026-08-31');
    });
  });

  describe('addDays', () => {
    it('crosses month and year ends in both directions', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    });

    it.each([
      ['2026-03-28', '2026-03-29', '2026-03-30'],
      ['2026-10-24', '2026-10-25', '2026-10-26'],
    ])('moves exactly one day over the DST change %s', (before, change, after) => {
      expect(addDays(before, 1)).toBe(change);
      expect(addDays(change, 1)).toBe(after);
      expect(addDays(after, -1)).toBe(change);
    });
  });

  describe('daysBetween', () => {
    it('counts whole days, signed, across DST changes and year ends', () => {
      expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
      expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
      expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
      expect(daysBetween('2026-11-05', '2026-11-01')).toBe(-4);
      expect(daysBetween('2026-11-01', '2026-11-01')).toBe(0);
    });
  });

  it('addMonths lands on the first of the target month across years', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('isLocalDate rejects impossible calendar days', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-2-3')).toBe(false);
  });

  describe('time zones', () => {
    it('labels a zone with its name and a UTC offset', () => {
      expect(timeZoneLabel('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(
        'Europe/Berlin (UTC+01:00)',
      );
      expect(timeZoneLabel('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(
        'Europe/Berlin (UTC+02:00)',
      );
      expect(timeZoneLabel('UTC', new Date('2026-07-15T12:00:00Z'))).toContain('UTC+00:00');
    });

    it('accepts real zones and rejects garbage', () => {
      expect(isValidTimeZone('Europe/Berlin')).toBe(true);
      expect(isValidTimeZone('Not/AZone')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
    });
  });
});
