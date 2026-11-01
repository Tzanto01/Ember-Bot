import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './problem';
import type { AuthService } from './auth';
import { guest, signedIn } from './guards';
import { type Me } from './models';
import { me } from './test-support';

function fakeSession(load: () => Promise<Me | null>, consentNeeded = false) {
  let prompted = false;
  return {
    loadMe: vi.fn(load),
    takeConsentPrompt: () => {
      if (prompted) return false;
      prompted = true;
      return consentNeeded;
    },
  } as unknown as AuthService;
}

describe('signedIn guard', () => {
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
