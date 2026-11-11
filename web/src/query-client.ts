import { QueryClient } from '@tanstack/react-query';
import { asApiError } from './lib/problem';
import type { Store } from './lib/store';

/** Screens whose data depends on the server's current day, so they refetch when the app is shown again. */
const dayScreens = new Set<unknown>(['today', 'history', 'year']);

/**
 * The app's query client: no retry on 4xx, one retry when the server can't be reached, two on other failures; queries run while the browser reports offline (so a failure shows the
 * error state instead of waiting); only Today, History and Year refetch on window focus, so a tab left open
 * overnight follows the new day.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        refetchOnWindowFocus: (query) => dayScreens.has(query.queryKey[0]),
        retry: (failures, error) => {
          const { status } = asApiError(error);
          return failures < (status === 0 ? 1 : 2) && !(status >= 400 && status < 500);
        },
      },
    },
  });
}

/**
 * Drops every cached query when the signed-in user changes (sign-out, session end, account deletion or another
 * sign-in), so one account's habits never show for the next. Returns the unsubscribe function.
 */
export function clearOnUserChange(me: Store<{ id: string } | null>, client: QueryClient): () => void {
  let userId = me.get()?.id ?? null;
  return me.subscribe(() => {
    const next = me.get()?.id ?? null;
    if (next !== userId) client.clear();
    userId = next;
  });
}
