import type { Language } from './i18n';

/** One version in `release-notes.json`. */
export interface ReleaseNote {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  notes: LocalizedNotes;
}

/** The notes of one version: English always, German when translated. */
export interface LocalizedNotes {
  en: string[];
  de?: string[];
}

const seenKey = 'ember.seenReleaseNotes';

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const list = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(text);

/** The notes in `language`, falling back to English when they aren't translated. */
export function notesIn(notes: LocalizedNotes, language: Language): string[] {
  return notes[language] ?? notes.en;
}

/** The entries of a valid `release-notes.json` body (newest first), or null when its shape is wrong or it is empty. */
export function parseReleaseNotes(body: unknown): ReleaseNote[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const entries: ReleaseNote[] = [];
  for (const entry of body as unknown[]) {
    if (!entry || typeof entry !== 'object') return null;
    const { version, date, notes } = entry as Record<string, unknown>;
    if (!text(version) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return null;
    if (!notes || typeof notes !== 'object') return null;
    const { en, de } = notes as Record<string, unknown>;
    if (!list(en) || (de !== undefined && !list(de))) return null;
    entries.push({ version, date, notes: de === undefined ? { en } : { en, de } });
  }
  return entries;
}

/** Fetches and validates `url` (a `release-notes.json`); throws when it is missing or malformed. */
export async function loadReleaseNotes(url = '/release-notes.json'): Promise<ReleaseNote[]> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Release notes answered ${response.status}`);
  const entries = parseReleaseNotes(await response.json());
  if (!entries) throw new Error('Release notes have an unexpected shape');
  return entries;
}

/** Query options for the release notes bundled with this build. */
export const releaseNotesQuery = {
  queryKey: ['release-notes'],
  queryFn: () => loadReleaseNotes(),
  staleTime: Infinity,
} as const;

/** The last version whose notes this device has seen: null when none is stored yet, undefined when storage fails. */
export function readSeenVersion(): string | null | undefined {
  try {
    return localStorage.getItem(seenKey);
  } catch {
    return undefined;
  }
}

/** Records `version` as seen on this device; a failing storage is ignored. */
export function markVersionSeen(version: string): void {
  try {
    localStorage.setItem(seenKey, version);
  } catch {}
}
