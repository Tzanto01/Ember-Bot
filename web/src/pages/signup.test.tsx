import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { api, auth } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import SignupPage from './signup';

describe('SignupPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
    localStorage.clear();
  });

  it('offers Discord as the other way in', () => {
    mockFetch();
    renderPage('/signup', SignupPage, '/signup');

    expect(screen.getByRole('link', { name: 'Continue with Discord' })).toHaveAttribute(
      'href',
      api.discordLoginUrl('/today'),
    );
  });

  it('keeps the address on this device after signing up, for the confirm page', async () => {
    const user = userEvent.setup();
    const fetch = mockFetch();
    renderPage('/signup', SignupPage, '/signup');

    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'a long sign-up phrase');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    (await fetch.next('POST', '/api/auth/register')).respond(200);

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ember.signupEmail') ?? '{}').email).toBe('new@example.test');
  });

  async function signUp(fetch: FetchMock) {
    const user = userEvent.setup();
    const router = renderPage('/signup', SignupPage, '/signup');
    await user.type(screen.getByLabelText('Email'), 'new@example.test');
    await user.type(screen.getByLabelText('Password'), 'a long sign-up phrase');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    (await fetch.next('POST', '/api/auth/register')).respond(200);
    await screen.findByText('We sent a 6-digit code to new@example.test. Enter it here to finish.');
    return { user, router };
  }

  it('signs in with the emailed code as soon as six digits are typed and continues to consent', async () => {
    const fetch = mockFetch();
    const { user, router } = await signUp(fetch);

    const code = screen.getByLabelText('6-digit code');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(code, '123456');

    const confirm = await fetch.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(confirm.body).toEqual({ email: 'new@example.test', code: '123456' });
    confirm.respond(200);
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);
    (await fetch.next('GET', '/api/me')).respond(200, {
      ...me,
      consent: { given: false, policyVersion: null, currentPolicyVersion: '1' },
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/consent'));
    expect(router.state.location.search).toBe('?returnUrl=%2Ftoday');
    expect(auth.signedIn()).toBe(true);
    expect(localStorage.getItem('ember.signupEmail')).toBeNull();
    expect(fetch.all.filter((c) => c.url.startsWith('/api/auth/confirm-email-code'))).toHaveLength(1);
  });

  it.each(['123 456', '123-456'])('takes a pasted code like "%s" as its six digits and signs in with it', async (pasted) => {
    const fetch = mockFetch();
    const { user } = await signUp(fetch);

    await user.click(screen.getByLabelText('6-digit code'));
    await user.paste(pasted);

    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    const confirm = await fetch.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(confirm.body).toEqual({ email: 'new@example.test', code: '123456' });
  });

  it('shows a turned-down code on the field and keeps the user on the page', async () => {
    const fetch = mockFetch();
    const { user, router } = await signUp(fetch);

    await user.type(screen.getByLabelText('6-digit code'), '000000');
    (await fetch.next('POST', '/api/auth/confirm-email-code?useCookies=true')).respond(401, {
      status: 401,
      type: 'invalid_code',
      detail: "That code didn't work. Check the newest email or send a new code.",
    });

    const error = await screen.findByText("That code didn't work. Check the newest email or send a new code.");
    const code = screen.getByLabelText('6-digit code');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code.getAttribute('aria-describedby')).toContain(error.closest('p')?.id);
    expect(code).toHaveFocus();
    expect(router.state.location.pathname).toBe('/signup');
    expect(auth.signedIn()).toBe(false);
  });

  it('sends a new code to the address just signed up with', async () => {
    const fetch = mockFetch();
    const { user } = await signUp(fetch);

    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    const resend = await fetch.next('POST', '/api/auth/resendConfirmationEmail');
    expect(resend.body).toEqual({ email: 'new@example.test' });
    resend.respond(200);

    expect(await screen.findByText('A new code is on its way. It can take a minute or two to arrive.')).toBeInTheDocument();
  });
});
