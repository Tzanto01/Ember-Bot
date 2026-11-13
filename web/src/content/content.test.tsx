import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { MomentDoor } from '@/components/moment/moment-door';
import { momentCopy } from '@/lib/moment/copy';
import type { MomentState, Practice } from '@/lib/moment/types';
import HelpPage from '@/pages/help';
import crisisLines from './crisis-lines.json';
import practicesJson from './practices.json';

const practices = practicesJson as Practice[];
const states: MomentState[] = ['rejected', 'overloaded', 'racing', 'replaying', 'unsure'];
const claims = /\b(treat|cure|therap|heal|clinical|diagnos|prevent|reliev|relief|reduc|proven)\w*/i;
const dizzy = 'If you feel dizzy, breathe normally.';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function claimsIn(texts: string[]): string[] {
  return texts.filter((text) => claims.test(text));
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

describe('practices.json', () => {
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
      expect(practice.steps.at(-1), practice.id).toEqual({ kind: 'text', text: dizzy });
  });
});

describe('crisis-lines.json', () => {
  const lines = crisisLines as {
    region: string;
    name: string;
    numbers: string[];
    hours: string;
    url?: string;
    checked: string;
  }[];
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

  it('finds no claim words in the bundled content, including basis', () => {
    expect(claimsIn(strings(practicesJson))).toEqual([]);
    expect(claimsIn(strings(crisisLines))).toEqual([]);
  });

  it('finds no claim words in the moment copy', () => {
    const texts = copyStrings();
    expect(texts.length).toBeGreaterThan(50);
    expect(claimsIn(texts)).toEqual([]);
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
});
