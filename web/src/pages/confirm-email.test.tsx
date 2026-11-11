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

  const invalidCode = {
    status: 401,
    type: 'invalid_code',
    detail: "That code didn't work. Check the newest email or send a new code.",
  };

  it('with a user and code in the link, signs in right away with this device\'s key and no password', async () => {
    localStorage.setItem(
      'ember.signupEmail',
      JSON.stringify({ email: 'new@example.test', signupKey: 'device-key', at: Date.now() }),
    );
    const router = renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?user=u1&code=123456');

    const confirm = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(confirm.body).toEqual({ userId: 'u1', code: '123456', signupKey: 'device-key' });
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    confirm.respond(200);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(mock.all.filter((c) => c.url.startsWith('/api/auth/confirm-email-code'))).toHaveLength(1);
  });

  it('when the link code fails, shows the code form with the error, asks for the email and sends a new code', async () => {
    const user = userEvent.setup();
    const router = renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?user=u1&code=111111');
    (await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true')).respond(401, invalidCode);

    const code = await screen.findByLabelText('6-digit code');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveFocus();
    expect(screen.getByText(invalidCode.detail)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /^Email/ }), 'new@example.test');
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    const resend = await mock.next('POST', '/api/auth/resendConfirmationEmail');
    expect(resend.body).toEqual({ email: 'new@example.test' });
    resend.respond(200);
    expect(await screen.findByText('A new code is on its way. It can take a minute or two to arrive.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('6-digit code'), '222222');
    const retry = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(retry.body).toEqual({ email: 'new@example.test', code: '222222' });
    retry.respond(200);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('without a link, fills in the address this device signed up with and signs in with the typed code', async () => {
    const user = userEvent.setup();
    localStorage.setItem('ember.signupEmail', JSON.stringify({ email: 'new@example.test', at: Date.now() }));
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email');

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '12 34 56');

    const confirm = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(confirm.body).toEqual({ email: 'new@example.test', code: '123456' });
  });

  it('opened on another device, the link asks only for the password and sends it with the code', async () => {
    const user = userEvent.setup();
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?user=u1&code=123456');
    const first = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(first.body).toEqual({ userId: 'u1', code: '123456' });
    first.respond(401, { status: 401, type: 'password_required', detail: 'Enter your password to finish on this device.' });

    const password = await screen.findByLabelText('Password');
    expect(password).toHaveFocus();
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    expect(screen.queryByRole('textbox', { name: /^Email/ })).not.toBeInTheDocument();
    await user.type(password, 'a long sign-up phrase');
    await user.click(screen.getByRole('button', { name: 'Finish signing up' }));

    const retry = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(retry.body).toEqual({ userId: 'u1', code: '123456', password: 'a long sign-up phrase' });
  });
});
