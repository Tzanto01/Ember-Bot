import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { auth } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import ConsentPage from './consent';

describe('ConsentPage', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  it('agrees to the current policy version, reloads me and lands on the returnUrl', async () => {
    auth.setMe({ ...me, consent: { given: true, policyVersion: '1', currentPolicyVersion: '2' } });
    const router = renderPage('/consent', ConsentPage, '/consent?returnUrl=%2Fhistory%3Fmonth%3D2026-10');
    expect(screen.getByRole('heading', { name: 'Our privacy policy changed' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'I agree' }));
    const consent = await mock.next('POST', '/api/me/consent');
    expect(consent.body).toEqual({ policyVersion: '2' });
    consent.respond(204);
    (await mock.next('GET', '/api/me')).respond(200, {
      ...me,
      consent: { given: true, policyVersion: '2', currentPolicyVersion: '2' },
    });

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe('/history?month=2026-10'),
    );
  });

  it('falls back to /today for an off-site returnUrl', async () => {
    auth.setMe({ ...me, consent: { given: false, policyVersion: null, currentPolicyVersion: '1' } });
    const router = renderPage('/consent', ConsentPage, '/consent?returnUrl=//evil.example');
    expect(screen.getByRole('heading', { name: 'One quick question' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'I agree' }));
    (await mock.next('POST', '/api/me/consent')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });
});
