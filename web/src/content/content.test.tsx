import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { MomentDoor } from '@/components/moment/moment-door';
import localeDe from '@/locales/de.json';
import localeEn from '@/locales/en.json';
import { momentCopy } from '@/lib/moment/copy';
import type { CrisisLine } from '@/lib/moment/region';
import type { MomentState, Practice } from '@/lib/moment/types';
import HelpPage from '@/pages/help';
import { inGerman } from '@/test-utils';
import crisisLinesDe from './crisis-lines.de.json';
import crisisLinesEn from './crisis-lines.en.json';
import practicesDe from './practices.de.json';
import practicesEn from './practices.en.json';

const languages = ['en', 'de'] as const;
const practiceFiles = { en: practicesEn as Practice[], de: practicesDe as Practice[] };
const crisisFiles = { en: crisisLinesEn as CrisisLine[], de: crisisLinesDe as CrisisLine[] };
const states: MomentState[] = ['rejected', 'overloaded', 'racing', 'replaying', 'unsure'];
const claims = /\b(treat|cure|therap|heal|clinical|diagnos|prevent|reliev|relief|reduc|proven)\w*/i;
const germanClaims =
  /(?<!\p{L})(behand|heil|geheilt|therap|klini|diagnos|vorbeug|vorgebeugt|verhind|lindr|linder|reduzi|bewiesen|nachgewiesen|nachweislich)\p{L}*/iu;
const storeFile = 'mobile/STORE.md';
const allowedClaimPhrases = [
  { file: storeFile, phrase: 'health' },
  { file: storeFile, phrase: 'Play may treat' },
  { file: storeFile, phrase: 'the policy treats' },
  { file: storeFile, phrase: 'makes no diagnosis, treatment or monitoring claim' },
  { file: storeFile, phrase: 'Avoid "treat", "therapy", "symptom", "medication adherence" and "clinical"' },
  { file: storeFile, phrase: 'diagnostics' },
];
const dizzy = {
  en: 'If you feel dizzy, breathe normally.',
  de: 'Wenn dir schwindlig wird, atme einfach normal.',
};

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function claimsIn(texts: string[], pattern = claims): string[] {
  return texts.filter((text) => pattern.test(text));
}

function germanClaimsIn(texts: string[]): string[] {
  return texts.filter((text) => germanClaims.test(text) || claims.test(text));
}

function copyStrings(): string[] {
  return Object.values(momentCopy).flatMap((value) =>
    typeof value === 'function'
      ? [(value as (...args: unknown[]) => string)('Sample', 2, 5)]
      : strings(value),
  );
}

function renderedText(ui: React.ReactElement): string[] {
  const router = createMemoryRouter([{ path: '*', element: ui }]);
  const { container, unmount } = render(<RouterProvider router={router} />);
  const labels = [...container.querySelectorAll('[aria-label]')].map(
    (element) => element.getAttribute('aria-label') ?? '',
  );
  const result = [container.textContent ?? '', ...labels];
  unmount();
  return result;
}

describe.each(languages)('practices.%s.json', (language) => {
  const practices = practiceFiles[language];

  it('has unique kebab-case ids and integer versions of at least 1', () => {
    const ids = practices.map((practice) => practice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const practice of practices) {
      expect(practice.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(Number.isInteger(practice.version)).toBe(true);
      expect(practice.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps states, step counts, text lengths and step parameters in range', () => {
    for (const practice of practices) {
      expect(practice.states.length, practice.id).toBeGreaterThan(0);
      for (const state of practice.states) expect(states, practice.id).toContain(state);
      expect(practice.steps.length, practice.id).toBeGreaterThanOrEqual(1);
      expect(practice.steps.length, practice.id).toBeLessThanOrEqual(12);
      for (const step of practice.steps) {
        if (step.kind !== 'breath') expect(step.text.length, practice.id).toBeLessThanOrEqual(160);
        if (step.kind === 'text') expect(step.text.trim(), practice.id).not.toBe('');
        if (step.kind === 'breath') {
          expect(step.inhale).toBeGreaterThanOrEqual(2);
          expect(step.inhale).toBeLessThanOrEqual(8);
          expect(step.exhale).toBeGreaterThanOrEqual(2);
          expect(step.exhale).toBeLessThanOrEqual(8);
          expect(step.hold).toBeGreaterThanOrEqual(0);
          expect(step.hold).toBeLessThanOrEqual(7);
          expect(step.rounds).toBeGreaterThanOrEqual(3);
          expect(step.rounds).toBeLessThanOrEqual(10);
        }
        if (step.kind === 'timer') {
          expect(step.seconds).toBeGreaterThanOrEqual(30);
          expect(step.seconds).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('covers every moment state', () => {
    const covered = new Set(practices.flatMap((practice) => practice.states));
    for (const state of states) expect(covered).toContain(state);
  });

  it('ships the initial six practices in the contract order with their states and parameters', () => {
    expect(practices.slice(0, 6).map((practice) => practice.id)).toEqual([
      'paced-breathing',
      'kind-voice',
      'grounding-54321',
      'cool-and-here',
      'ride-the-wave',
      'set-it-down',
    ]);
    const byId = Object.fromEntries(practices.map((practice) => [practice.id, practice]));
    expect(byId['paced-breathing']!.states).toEqual(['racing', 'overloaded', 'unsure']);
    expect(byId['kind-voice']!.states).toEqual(['rejected']);
    expect(byId['grounding-54321']!.states).toEqual(['overloaded', 'racing', 'replaying']);
    expect(byId['cool-and-here']!.states).toEqual(['racing', 'overloaded']);
    expect(byId['ride-the-wave']!.states).toEqual(['rejected', 'replaying']);
    expect(byId['set-it-down']!.states).toEqual(['replaying']);
    expect(byId['paced-breathing']!.steps).toContainEqual(
      expect.objectContaining({ kind: 'breath', inhale: 4, exhale: 6, rounds: 6 }),
    );
    expect(byId['ride-the-wave']!.steps).toContainEqual(
      expect.objectContaining({ kind: 'timer', seconds: 90 }),
    );
  });

  it('ends every practice with a breath step on the dizziness reminder', () => {
    const breathing = practices.filter((practice) =>
      practice.steps.some((step) => step.kind === 'breath'),
    );
    expect(breathing.length).toBeGreaterThan(0);
    for (const practice of breathing)
      expect(practice.steps.at(-1), practice.id).toEqual({ kind: 'text', text: dizzy[language] });
  });
});

describe.each(languages)('crisis-lines.%s.json', (language) => {
  const lines = crisisFiles[language];
  const numbersOf = (region: string) =>
    lines.filter((l) => l.region === region).flatMap((l) => l.numbers);

  it('has the contract shape and every region', () => {
    expect([...new Set(lines.map((line) => line.region))].sort()).toEqual(
      ['AT', 'CH', 'DE', 'EU', 'GB', 'IE', 'INTL', 'US'].sort(),
    );
    for (const line of lines) {
      expect(line.name).not.toBe('');
      expect(line.hours).not.toBe('');
      expect(line.numbers.length).toBeGreaterThan(0);
      if (line.url !== undefined) expect(line.url).toMatch(/^https:\/\//);
      expect(line.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(`${line.checked}T00:00:00Z`);
      expect(date.toISOString().slice(0, 10)).toBe(line.checked);
    }
  });

  it('lists the contract numbers', () => {
    expect(numbersOf('DE')).toEqual(
      expect.arrayContaining(['0800 111 0 111', '0800 111 0 222', '116 123']),
    );
    expect(numbersOf('US')).toContain('988');
    expect(numbersOf('EU')).toContain('112');
  });
});

describe('English and German content files', () => {
  it('have the same practices apart from the shown text', () => {
    const shape = (practices: Practice[]) =>
      practices.map(({ title: _title, steps, ...rest }) => ({
        ...rest,
        steps: steps.map((step) => {
          if (step.kind === 'text') return { kind: step.kind };
          if (step.kind === 'timer') return { kind: step.kind, seconds: step.seconds };
          return step;
        }),
      }));
    expect(shape(practiceFiles.de)).toEqual(shape(practiceFiles.en));
  });

  it('have the same crisis lines apart from names and hours', () => {
    const shape = (lines: CrisisLine[]) =>
      lines.map(({ name: _name, hours: _hours, ...rest }) => rest);
    expect(shape(crisisFiles.de)).toEqual(shape(crisisFiles.en));
  });
});

describe('claims wordlist', () => {
  it('matches claim words and their inflections but not ordinary words', () => {
    for (const bad of [
      'This will treat anxiety',
      'a Cure',
      'treatment',
      'Therapist',
      'healing',
      'it prevents panic',
      'reduces stress',
      'quick relief',
      'proven method',
      'clinically tested',
      'diagnose yourself',
    ])
      expect(claimsIn([bad]), bad).toEqual([bad]);
    for (const fine of ['Notice, name and breathe.', 'Ride it out', 'Settle and steady'])
      expect(claimsIn([fine]), fine).toEqual([]);
  });

  it('matches German claim words and their inflections but not ordinary words', () => {
    for (const bad of [
      'Das behandelt Angst',
      'eine Behandlung',
      'heilen',
      'Heilung',
      'Therapie',
      'therapeutisch',
      'klinisch getestet',
      'Diagnose',
      'diagnostizieren',
      'vorbeugen',
      'lindert Stress',
      'reduziert Angst',
      'verhindert Panik',
      'wissenschaftlich bewiesen',
      'nachgewiesen',
    ])
      expect(germanClaimsIn([bad]), bad).toEqual([bad]);
    for (const fine of ['Spür nach, benenne und atme.', 'Die Welle reiten', 'Zur Ruhe kommen'])
      expect(germanClaimsIn([fine]), fine).toEqual([]);
  });

  it('finds no claim words in the bundled content, including basis', () => {
    expect(claimsIn(strings(practicesEn))).toEqual([]);
    expect(claimsIn(strings(crisisLinesEn))).toEqual([]);
    expect(germanClaimsIn(strings(practicesDe))).toEqual([]);
    expect(germanClaimsIn(strings(crisisLinesDe))).toEqual([]);
  });

  it('finds no claim words in any English or German app string', () => {
    expect(claimsIn(strings(localeEn).map((text) => text.replace(/\bhealth\b/gi, ' ')))).toEqual([]);
    expect(germanClaimsIn(strings(localeDe))).toEqual([]);
  });

  it('finds no claim words in the moment copy', () => {
    const texts = copyStrings();
    expect(texts.length).toBeGreaterThan(50);
    expect(claimsIn(texts)).toEqual([]);
  });

  it('finds no claim words in the German moment copy as rendered', async () => {
    await inGerman();
    const texts = copyStrings();
    expect(texts).toContain(localeDe['moment.leave']);
    expect(germanClaimsIn(texts)).toEqual([]);
  });

  it('finds no claim words in the rendered crisis lines, doors and help page', () => {
    const texts = [
      ...renderedText(<CrisisLines />),
      ...(['today', 'hero', 'quiet'] as const).flatMap((variant) =>
        renderedText(<MomentDoor variant={variant} />),
      ),
      ...renderedText(<HelpPage />),
    ];
    expect(texts.join(' ')).toContain('crisis service');
    expect(texts.join(' ')).toContain('I need a moment');
    expect(claimsIn(texts)).toEqual([]);
  });

  it('finds no claim words in the shell, manifest, release notes, README and store listing', () => {
    const files = [
      'web/index.html',
      'web/public/manifest.webmanifest',
      'web/public/release-notes.json',
      'README.md',
      storeFile,
    ];
    const escape = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hits: string[] = [];
    for (const file of files) {
      let text = readFileSync(resolve(__dirname, '../../..', file), 'utf8');
      for (const entry of allowedClaimPhrases.filter((allowed) => allowed.file === file)) {
        const phrase = new RegExp(escape(entry.phrase), 'gi');
        expect(text, `${file}: stale allowlist entry ${entry.phrase}`).toMatch(phrase);
        text = text.replace(phrase, ' ');
      }
      for (const match of text.match(new RegExp(claims.source, 'gi')) ?? []) hits.push(`${file}: ${match}`);
    }
    expect(hits).toEqual([]);
  });
});
