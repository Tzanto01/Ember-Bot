import { QueryClient } from '@tanstack/react-query';
import { asApiError } from './lib/problem';
import type { Store } from './lib/store';

/** The app's query client: no retry on 4xx, no refetch on window focus. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failures, error) => {
          const { status } = asApiError(error);
          return failures < 2 && !(status >= 400 && status < 500);
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
