import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { auth } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import ConfirmEmailPage from './confirm-email';

describe('ConfirmEmailPage', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
    localStorage.clear();
  });

  async function confirmWith(password: string) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Confirm email' }));
    return mock.next('POST', '/api/auth/confirmEmail');
  }

  it('removes the code from the address bar, then confirms with the user id, code and password', async () => {
    const router = renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    await waitFor(() => expect(router.state.location.search).not.toContain('c0de-123'));

    const call = await confirmWith('a long sign-up phrase');
    expect(call.body).toEqual({ userId: 'u1', code: 'c0de-123', password: 'a long sign-up phrase' });
    call.respond(200);

    expect(await screen.findByRole('heading', { name: "You're confirmed" })).toBeInTheDocument();
  });

  it('after confirming, signs in with the address this device signed up with and continues to consent', async () => {
    localStorage.setItem('ember.signupEmail', JSON.stringify({ email: 'new@example.test', at: Date.now() }));
    const router = renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    (await confirmWith('a long sign-up phrase')).respond(200);
    const login = await mock.next('POST', '/api/auth/login?useSessionCookies=true');
    expect(login.body).toEqual({ email: 'new@example.test', password: 'a long sign-up phrase' });
    login.respond(200);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, {
      ...me,
      consent: { given: false, policyVersion: null, currentPolicyVersion: '1' },
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/consent'));
    expect(router.state.location.search).toBe('?returnUrl=%2Ftoday');
    expect(localStorage.getItem('ember.signupEmail')).toBeNull();
  });

  it('shows "You\'re confirmed" with a sign-in button when that sign-in does not work', async () => {
    localStorage.setItem('ember.signupEmail', JSON.stringify({ email: 'other@example.test', at: Date.now() }));
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    (await confirmWith('a long sign-up phrase')).respond(200);
    (await mock.next('POST', '/api/auth/login?useSessionCookies=true')).respond(401, { status: 401, detail: 'Failed' });

    expect(await screen.findByRole('heading', { name: "You're confirmed" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('does not sign in with an address kept more than a day ago', async () => {
    localStorage.setItem('ember.signupEmail', JSON.stringify({ email: 'old@example.test', at: Date.now() - 25 * 60 * 60 * 1000 }));
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    (await confirmWith('a long sign-up phrase')).respond(200);

    expect(await screen.findByRole('heading', { name: "You're confirmed" })).toBeInTheDocument();
    expect(mock.all.some((c) => c.url.startsWith('/api/auth/login'))).toBe(false);
  });

  it('on a 401 explains it as a form problem with a reset link and offers a new link', async () => {
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    (await confirmWith('wrong phrase')).respond(401, { status: 401, title: 'Unauthorized' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("That link or password didn't work.");
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByLabelText('Email for a new link')).toBeInTheDocument();
  });
});
