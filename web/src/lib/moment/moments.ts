import practicesDe from '@/content/practices.de.json';
import practicesEn from '@/content/practices.en.json';
import { de, en } from '@/lib/i18n';
import type { LocalDateString } from '@/lib/models';

/** One saved moment reflection, read back from a day note. Parts the block left out are missing. */
export interface SavedMoment {
  date: LocalDateString;
  /** `HH:MM`. */
  time: string;
  tile?: string;
  before?: string;
  after?: string;
  setItOff?: string;
  helped?: string;
}

const locales = [en, de];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function prefixes(
  key: 'moment.block.heading' | 'moment.block.setItOff' | 'moment.block.helped',
): string[] {
  return [...new Set(locales.map((locale) => locale[key].split(/\{\{\s*\w+\s*\}\}/)[0]!))];
}

const headingLine = new RegExp(
  `^(?:${prefixes('moment.block.heading').map(escape).join('|')})(\\d{1,2}:\\d{2})(?: · (.*))?$`,
);
const setItOffPrefixes = prefixes('moment.block.setItOff');
const helpedPrefixes = prefixes('moment.block.helped');
const intensityWords = new Set(
  locales.flatMap((locale) =>
    (['1', '2', '3', '4', '5'] as const).map((n) => locale[`moment.intensity.${n}`]),
  ),
);
const nothingWords = new Set(locales.map((locale) => locale['moment.reflect.nothingHelped']));

function after(line: string, starts: string[]): string | null {
  const start = starts.find((prefix) => line.startsWith(prefix));
  return start === undefined ? null : line.slice(start.length).trim();
}

function readHeading(date: LocalDateString, time: string, rest: string | undefined): SavedMoment {
  const moment: SavedMoment = { date, time };
  for (const part of rest?.split(' · ') ?? []) {
    const text = part.trim();
    if (!text) continue;
    if (text.includes('→')) {
      const [before, now] = text.split('→').map((side) => side.trim());
      if (before) moment.before = before;
      if (now) moment.after = now;
    } else if (moment.tile === undefined && !intensityWords.has(text)) {
      moment.tile = text;
    } else {
      moment.before = text;
    }
  }
  return moment;
}

/**
 * The moment reflection blocks in a day note, in note order (contract companion-v1 "Your moments"). A block starts with
 * a line `Moment HH:MM · {tile} · {before} → {after}` and runs until a blank line or the next such line; its "What set
 * it off:" and "What helped:" lines are read in English and German. A line that continues a label adds to it.
 */
export function parseMoments(date: LocalDateString, text: string | null): SavedMoment[] {
  const moments: SavedMoment[] = [];
  let current: SavedMoment | null = null;
  let label: 'setItOff' | 'helped' | null = null;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = headingLine.exec(line);
    if (heading) {
      current = readHeading(date, heading[1]!, heading[2]);
      moments.push(current);
      label = null;
      continue;
    }
    if (!current) continue;
    if (!line) {
      current = null;
      continue;
    }
    const setItOff = after(line, setItOffPrefixes);
    const helped = setItOff === null ? after(line, helpedPrefixes) : null;
    if (setItOff !== null) {
      label = 'setItOff';
      current.setItOff = setItOff;
    } else if (helped !== null) {
      label = 'helped';
      current.helped = helped;
    } else if (label) {
      current[label] = `${current[label]}\n${line}`;
    }
  }
  return moments;
}

/** True when a day note holds at least one moment reflection block. */
export function hasMoments(text: string | null): boolean {
  return parseMoments('', text).length > 0;
}

/** False for an empty "what helped" or "Nothing really" (in either language). */
export function helpedSomething(helped: string | undefined): helped is string {
  return !!helped?.trim() && !nothingWords.has(helped.trim());
}

/** The id of the practice whose title (in either language) is `helped`, if any. */
export function helpedPractice(helped: string): string | undefined {
  const title = helped.trim();
  return [...practicesEn, ...practicesDe].find((practice) => practice.title === title)?.id;
}
