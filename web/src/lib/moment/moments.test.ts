import { describe, expect, it } from 'vitest';
import { hasMoments, helpedPractice, helpedSomething, parseMoments } from './moments';

describe('parseMoments', () => {
  it('reads English and German blocks with their parts, and stops at a blank line or the next heading', () => {
    const text = [
      'A quiet morning.',
      '',
      'Moment 09:05 · Too much / overloaded · A lot → Some',
      'What set it off: the inbox',
      'What helped: Slow breathing',
      '',
      'Back to my own words.',
      'Moment 21:40 · Racing / on edge · Strong',
      'Was es ausgelöst hat: zu viele Termine',
      'und der Lärm',
      'Moment 22:10 · Nicht sicher',
      'Was geholfen hat: Zur Seite legen',
    ].join('\n');

    expect(parseMoments('2026-11-01', text)).toEqual([
      {
        date: '2026-11-01',
        time: '09:05',
        tile: 'Too much / overloaded',
        before: 'A lot',
        after: 'Some',
        setItOff: 'the inbox',
        helped: 'Slow breathing',
      },
      {
        date: '2026-11-01',
        time: '21:40',
        tile: 'Racing / on edge',
        before: 'Strong',
        setItOff: 'zu viele Termine\nund der Lärm',
      },
      { date: '2026-11-01', time: '22:10', tile: 'Nicht sicher', helped: 'Zur Seite legen' },
    ]);
  });

  it('reads an intensity without a tile and an "after" without a "before"', () => {
    expect(
      parseMoments('2026-11-02', 'Moment 10:00 · A lot\nMoment 11:00 · → Ein bisschen'),
    ).toEqual([
      { date: '2026-11-02', time: '10:00', before: 'A lot' },
      { date: '2026-11-02', time: '11:00', after: 'Ein bisschen' },
    ]);
  });

  it('finds nothing in a note without a moment heading', () => {
    expect(parseMoments('2026-11-03', 'Moments like this are nice.\nWhat helped: tea')).toEqual([]);
    expect(hasMoments(null)).toBe(false);
    expect(hasMoments('Moment 08:00')).toBe(true);
  });
});

describe('what helped', () => {
  it("maps a practice title in either language to its id and leaves the user's own words alone", () => {
    expect(helpedPractice('Slow breathing')).toBe('paced-breathing');
    expect(helpedPractice('Langsam atmen')).toBe('paced-breathing');
    expect(helpedPractice('a walk')).toBeUndefined();
  });

  it('treats empty and "Nothing really" in either language as nothing to add', () => {
    expect(helpedSomething(undefined)).toBe(false);
    expect(helpedSomething('Nothing really')).toBe(false);
    expect(helpedSomething('Nichts so richtig')).toBe(false);
    expect(helpedSomething('tea')).toBe(true);
  });
});
