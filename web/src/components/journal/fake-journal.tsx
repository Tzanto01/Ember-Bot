import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { JournalApi, JournalState } from '@/lib/journal/types';
import type { DayNote, OwnMood } from '@/lib/models';
import { Store } from '@/lib/store';
import { JournalContext } from './journal-context';

/** Test helper: an in-memory {@link JournalApi} whose screen-facing methods are `vi.fn` mocks. */
export function fakeJournal({
  state = 'off',
  notes = [],
  moods = [],
}: { state?: JournalState; notes?: DayNote[]; moods?: OwnMood[] } = {}) {
  const unused = () => vi.fn(() => Promise.reject(new Error('not used by screens')));
  const fake = {
    state: new Store<JournalState>(state),
    changed: new Store(0),
    notes: vi.fn(async (from?: string, to?: string) => ({
      notes: notes.filter((n) => (!from || n.date >= from) && (!to || n.date <= to)),
      hidden: 0,
    })),
    save: vi.fn(async (_date: string, _entry: Pick<DayNote, 'text' | 'mood'>) => ({ queued: false })),
    moods: vi.fn(async () => moods),
    addMood: vi.fn(async (mood: { label: string; emoji: string | null }): Promise<OwnMood> => ({
      id: 99,
      archived: false,
      ...mood,
    })),
    updateMood: vi.fn(async (id: number, patch: Partial<OwnMood>): Promise<OwnMood> => ({
      ...moods.find((m) => m.id === id)!,
      ...patch,
    })),
    restore: unused(),
    enable: unused(),
    unlock: unused(),
    setPassphrase: unused(),
    finishMigration: unused(),
    disable: unused(),
    discard: unused(),
    exportDecrypted: unused(),
    forget: unused(),
  } satisfies JournalApi;
  return fake;
}

/** Test helper: renders `ui` with `journal`, a fresh query client and a memory router. */
export function renderWithJournal(ui: ReactNode, journal: JournalApi) {
  const router = createMemoryRouter([{ path: '*', element: <JournalContext value={journal}>{ui}</JournalContext> }]);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
