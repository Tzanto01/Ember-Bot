import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CachedHabits } from './device-store';
import { habitsCache } from './startup';
import { habit, me } from './test-support';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => undefined }));

function deviceStore(entry: CachedHabits | null) {
  return { habits: vi.fn(async () => entry), saveHabits: vi.fn(async () => undefined) };
}

describe('habitsCache', () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the signed-in user's habit list and serves it offline while its day is still today", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    const store = deviceStore({ userId: me.id, timeZone: me.timezone, habits: [habit] });
    const cache = habitsCache(store, () => me);

    cache.save('/api/habits', [habit]);
    cache.save('/api/routines', []);
    expect(store.saveHabits).toHaveBeenCalledTimes(1);
    expect(store.saveHabits).toHaveBeenCalledWith({ userId: me.id, timeZone: me.timezone, habits: [habit] });
    expect(await cache.load('/api/habits')).toEqual([habit]);
    expect(await cache.load('/api/routines')).toBeUndefined();
  });

  it('serves nothing from another day or without a signed-in user', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] });
    const store = deviceStore({ userId: me.id, timeZone: me.timezone, habits: [habit] });

    expect(await habitsCache(store, () => me).load('/api/habits')).toBeUndefined();
    expect(await habitsCache(store, () => null).load('/api/habits')).toBeUndefined();
  });
});
