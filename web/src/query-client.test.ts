import { describe, expect, it } from 'vitest';
import { Store } from './lib/store';
import { clearOnUserChange, createQueryClient } from './query-client';

describe('clearOnUserChange', () => {
  it("forgets the previous user's cached data on sign-out and on a different sign-in, but not on a refresh of the same user", () => {
    const me = new Store<{ id: string } | null>({ id: 'a' });
    const client = createQueryClient();
    clearOnUserChange(me, client);

    client.setQueryData(['today'], 'a-habits');
    me.set({ id: 'a' });
    expect(client.getQueryData(['today'])).toBe('a-habits');

    me.set(null);
    expect(client.getQueryData(['today'])).toBeUndefined();

    client.setQueryData(['today'], 'stale');
    me.set({ id: 'b' });
    expect(client.getQueryData(['today'])).toBeUndefined();
  });
});
