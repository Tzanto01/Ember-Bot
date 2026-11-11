import { createContext, useContext } from 'react';
import type { JournalApi } from '@/lib/journal/types';
import { journal } from '@/lib/services';

/** The journal screens read from; the app's instance by default, a fake in tests (`<JournalContext value={fake}>`). */
export const JournalContext = createContext<JournalApi>(journal);

/** The current {@link JournalApi}. */
export function useJournal(): JournalApi {
  return useContext(JournalContext);
}
