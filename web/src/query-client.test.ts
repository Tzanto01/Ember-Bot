import { focusManager, onlineManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('createQueryClient', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it('runs a query while the browser reports offline, so its error shows instead of waiting', async () => {
    onlineManager.setOnline(false);
    const client = createQueryClient();
    const queryFn = vi.fn(() => Promise.reject(new Error('offline')));

    await expect(client.fetchQuery({ queryKey: ['history'], queryFn, retry: false })).rejects.toThrow('offline');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('refetches Today, History and Year when the window is focused again, but not other screens', async () => {
    const client = createQueryClient();
    client.mount();
    const calls = new Map<string, number>();
    const observe = (key: string) =>
      new QueryObserver(client, {
        queryKey: [key],
        queryFn: async () => calls.set(key, (calls.get(key) ?? 0) + 1).get(key),
      }).subscribe(() => undefined);
    const stops = ['today', 'history', 'year', 'settings'].map(observe);
    await vi.waitFor(() => expect(calls.size).toBe(4));

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await vi.waitFor(() => expect(Object.fromEntries(calls)).toEqual({ today: 2, history: 2, year: 2, settings: 1 }));
    stops.forEach((stop) => stop());
    client.unmount();
  });
});
