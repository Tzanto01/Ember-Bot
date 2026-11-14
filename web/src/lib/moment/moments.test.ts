import { describe, expect, it } from 'vitest';
import { inGerman } from '@/test-utils';
import { reflectionBlock } from './reflection';
import { hasMoments, helpedPractice, helpedSomething, parseMoments } from './moments';

describe('parseMoments', () => {
  it('reads English and German blocks with their parts, and stops at a blank line or the next heading', () => {
    const text = [
      'A quiet morning.',
      '',
      'Moment 09:05 · Too much / overloaded · Very strong → Noticeable',
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
        before: 'Very strong',
        after: 'Noticeable',
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
      parseMoments('2026-11-02', 'Moment 10:00 · Very strong\nMoment 11:00 · → Leicht'),
    ).toEqual([
      { date: '2026-11-02', time: '10:00', before: 'Very strong' },
      { date: '2026-11-02', time: '11:00', after: 'Leicht' },
    ]);
  });

  it('finds nothing in a note without a moment heading', () => {
    expect(parseMoments('2026-11-03', 'Moments like this are nice.\nWhat helped: tea')).toEqual([]);
    expect(hasMoments(null)).toBe(false);
    expect(hasMoments('Moment 08:00')).toBe(true);
  });
});

describe('reflection blocks round trip', () => {
  const reflection = {
    time: '09:05',
    tile: 'Too much / overloaded',
    before: 'Very strong',
    after: 'Noticeable',
    trigger: 'the inbox',
    helped: 'Slow breathing',
  };
  const expected = {
    date: '2026-11-01',
    time: '09:05',
    tile: 'Too much / overloaded',
    before: 'Very strong',
    after: 'Noticeable',
    setItOff: 'the inbox',
    helped: 'Slow breathing',
  };

  it('reads back what reflectionBlock wrote in English', () => {
    const block = reflectionBlock(reflection);
    expect(block).toBe(
      'Moment 09:05 · Too much / overloaded · Very strong → Noticeable\nWhat set it off: the inbox\nWhat helped: Slow breathing',
    );
    expect(parseMoments('2026-11-01', block)).toEqual([expected]);
  });

  it('reads back what reflectionBlock wrote with the app in German, to the same fields', async () => {
    await inGerman();
    const block = reflectionBlock(reflection);
    expect(block).toContain('Was es ausgelöst hat: the inbox');
    expect(block).toContain('Was geholfen hat: Slow breathing');
    expect(parseMoments('2026-11-01', block)).toEqual([expected]);
  });

  it('reads German intensity words as the intensity, not as a tile', async () => {
    await inGerman();
    const block = reflectionBlock({ time: '07:30', before: 'Stark', after: 'Spürbar' });
    expect(parseMoments('2026-11-01', block)).toEqual([
      { date: '2026-11-01', time: '07:30', before: 'Stark', after: 'Spürbar' },
    ]);
  });

  it('finds several blocks in one note, free text before and after, in note order and in both languages', async () => {
    const english = reflectionBlock({ time: '08:00', tile: 'Racing / on edge', helped: 'a walk' });
    await inGerman();
    const german = reflectionBlock({ time: '20:15', trigger: 'Lärm', helped: 'Nichts so richtig' });
    const note = ['Before: my own words.', '', english, '', 'Between blocks.', '', german, '', 'The end.'].join(
      '\n',
    );

    expect(parseMoments('2026-11-01', note)).toEqual([
      { date: '2026-11-01', time: '08:00', tile: 'Racing / on edge', helped: 'a walk' },
      { date: '2026-11-01', time: '20:15', setItOff: 'Lärm', helped: 'Nichts so richtig' },
    ]);
  });

  it('does not swallow the free text that follows a block directly after a blank line', () => {
    const note = `${reflectionBlock({ time: '08:00', trigger: 'noise' })}\n\nWhat helped: tea, I think.`;
    expect(parseMoments('2026-11-01', note)[0]).toEqual({
      date: '2026-11-01',
      time: '08:00',
      setItOff: 'noise',
    });
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
