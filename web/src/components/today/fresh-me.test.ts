import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/lib/services';
import { me } from '@/lib/test-support';
import { loadFreshMe } from './fresh-me';

describe('loadFreshMe', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    auth.setMe({ ...me, timezone: 'UTC', localToday: '2026-11-04' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    auth.clearSession();
  });

  it('reloads a current me once it is more than five minutes old', async () => {
    const loadMe = vi.spyOn(auth, 'loadMe').mockResolvedValue(null);

    await loadFreshMe();
    vi.setSystemTime(new Date('2026-11-04T12:04:00Z'));
    await loadFreshMe();
    vi.setSystemTime(new Date('2026-11-04T12:06:00Z'));
    await loadFreshMe();

    expect(loadMe.mock.calls.map(([force]) => force)).toEqual([false, false, true]);
  });
});
