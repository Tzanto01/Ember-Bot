import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './problem';
import type { AuthService } from './auth';
import { forgetUnreachable, guest, rememberedMe, rememberMe, signedIn, unreachableMs } from './guards';
import { type Me } from './models';
import { Store } from './store';
import { me } from './test-support';

function fakeSession(load: () => Promise<Me | null>, consentNeeded = false) {
  let prompted = false;
  return {
    me: new Store<Me | null>(null),
    loadMe: vi.fn(load),
    hasLoadedMe: vi.fn(() => false),
    takeConsentPrompt: () => {
      if (prompted) return false;
      prompted = true;
      return consentNeeded;
    },
  } as unknown as AuthService;
}

describe('signedIn guard', () => {
  afterEach(() => forgetUnreachable());

  it('sends a signed-out user to /login with the return URL', async () => {
    const session = fakeSession(async () => null);

    expect(await signedIn('/history?month=2026-10', session)).toBe(
      '/login?returnUrl=%2Fhistory%3Fmonth%3D2026-10',
    );
  });

  it('sends the user to /login with reason=offline when me cannot be loaded', async () => {
    const session = fakeSession(async () => Promise.reject(new ApiError(0, null)));

    expect(await signedIn('/today', session)).toBe('/login?returnUrl=%2Ftoday&reason=offline');
  });

  it('offers the consent step once per session, then lets the user through', async () => {
    const session = fakeSession(async () => me, true);

    expect(await signedIn('/today', session)).toBe('/consent?returnUrl=%2Ftoday');
    expect(await signedIn('/today', session)).toBeNull();
  });

  it('lets a signed-in user with consent through', async () => {
    expect(await signedIn('/today', fakeSession(async () => me))).toBeNull();
  });

  it('sends a signed-in user to /keep-data while device data waits, but not from the consent or keep-data steps', async () => {
    const upgrading = new Store<'account' | 'local' | 'upgrading'>('upgrading');
    const session = fakeSession(async () => me);

    expect(await signedIn('/today', session, upgrading)).toBe('/keep-data');
    expect(await signedIn('/consent?returnUrl=%2Ftoday', session, upgrading)).toBeNull();
    expect(await signedIn('/keep-data', session, upgrading)).toBeNull();
    expect(await signedIn('/today', session, new Store<'account' | 'local' | 'upgrading'>('account'))).toBeNull();
  });
});

describe('signedIn guard offline', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    forgetUnreachable();
  });
  const offline = () => Promise.reject(new ApiError(0, null));

  it("lets a user through on today's remembered me when the API can't be reached, and skips the consent step for now", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    rememberMe(me);
    const session = fakeSession(offline, true);

    expect(await signedIn('/today', session)).toBeNull();
    expect(session.me.get()).toEqual(me);
    expect(await signedIn('/today', session)).toBeNull();
  });

  it('takes the offline path without asking the API again for a while after it was unreachable', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    const session = fakeSession(offline);

    expect(await signedIn('/today', session)).toBe('/login?returnUrl=%2Ftoday&reason=offline');
    session.me.set(me);
    expect(await signedIn('/history', session)).toBeNull();
    expect(session.loadMe).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + unreachableMs);
    await signedIn('/today', session);
    expect(session.loadMe).toHaveBeenCalledTimes(2);
    forgetUnreachable();
    await signedIn('/today', session);
    expect(session.loadMe).toHaveBeenCalledTimes(3);
  });

  it('asks the API again right away once a sign-in succeeded after it was unreachable', async () => {
    const session = fakeSession(offline);
    expect(await signedIn('/today', session)).toBe('/login?returnUrl=%2Ftoday&reason=offline');

    vi.mocked(session.loadMe).mockResolvedValue(me);
    vi.mocked(session.hasLoadedMe).mockReturnValue(true);
    expect(await signedIn('/today', session)).toBeNull();
    expect(session.loadMe).toHaveBeenCalledTimes(2);
  });

  it('keeps the login redirect for a remembered me from another day, after sign-out, and on a server error', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] });
    rememberMe(me);
    expect(rememberedMe()).toBeNull();
    expect(await signedIn('/today', fakeSession(offline))).toBe('/login?returnUrl=%2Ftoday&reason=offline');

    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    forgetUnreachable();
    expect(await signedIn('/today', fakeSession(() => Promise.reject(new ApiError(500, null))))).toBe(
      '/login?returnUrl=%2Ftoday&reason=offline',
    );
    rememberMe(null);
    forgetUnreachable();
    expect(await signedIn('/today', fakeSession(offline))).toBe('/login?returnUrl=%2Ftoday&reason=offline');
  });

  it('forgets the remembered me once the server says signed out, so a later offline start asks to sign in', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), toFake: ['Date'] });
    rememberMe(me);

    expect(await signedIn('/today', fakeSession(async () => null))).toBe('/login?returnUrl=%2Ftoday');
    expect(await signedIn('/today', fakeSession(offline))).toBe('/login?returnUrl=%2Ftoday&reason=offline');
  });
});

describe('guest guard', () => {
  it('sends a signed-in user to /today', async () => {
    expect(await guest(fakeSession(async () => me))).toBe('/today');
  });

  it('lets a signed-out user through', async () => {
    expect(await guest(fakeSession(async () => null))).toBeNull();
  });

  it('lets the user through when me cannot be loaded', async () => {
    expect(await guest(fakeSession(async () => Promise.reject(new ApiError(0, null))))).toBeNull();
  });
});
