import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { api, auth } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import LoginPage from './login';

describe('LoginPage', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  async function signIn(password: string) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('shows a wrong password as a form alert saying the details do not match, never as a session end', async () => {
    const router = renderPage('/login', LoginPage, '/login');

    await signIn('not the password');
    (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(401, {
      status: 401,
      title: 'Unauthorized',
      detail: 'Failed',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/match/);
    expect(screen.queryByText(/session ended/i)).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('ignores an off-site returnUrl: Discord and the email sign-in both return to /today', async () => {
    const router = renderPage('/login', LoginPage, '/login?returnUrl=//evil.example');
    expect(screen.getByRole('link', { name: 'Sign in with Discord' })).toHaveAttribute(
      'href',
      api.discordLoginUrl('/today'),
    );

    await signIn('a long passphrase');
    (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(200);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('announces a deleted account as a status', () => {
    renderPage('/login', LoginPage, '/login?reason=deleted');

    expect(screen.getByRole('status')).toHaveTextContent(/deleted/);
  });
});
