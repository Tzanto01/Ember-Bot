import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/problem';
import { api, auth, localMode } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import ConfirmEmailPage from './confirm-email';
import LoginPage from './login';

const native = vi.hoisted(() => ({
  opened: [] as string[],
  appUrlOpen: null as ((event: { url: string }) => void) | null,
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: async ({ url }: { url: string }) => void native.opened.push(url), close: async () => undefined },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, listener: (event: { url: string }) => void) => {
      native.appUrlOpen = listener;
      return { remove: async () => undefined };
    },
  },
}));

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('account'), evicted: new Store(false), cancelUpgrade: vi.fn(async () => {}) },
  };
});

describe('LoginPage', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = mockFetch();
  });

  afterEach(() => {
    env.native = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    auth.clearSession();
    localMode.mode.set('account');
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

  it('for an unconfirmed email offers entering the code, with the typed address carried over', async () => {
    const router = createMemoryRouter(
      [
        { path: '/login', element: <main id="main"><LoginPage /></main> },
        { path: '/confirm-email', element: <main id="main"><ConfirmEmailPage /></main> },
      ],
      { initialEntries: ['/login'] },
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await signIn('a long sign-up phrase');
    (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(401, { status: 401, detail: 'NotAllowed' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Enter your code' }));

    expect(router.state.location.pathname).toBe('/confirm-email');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    const confirm = await mock.next('POST', '/api/auth/confirm-email-code?useCookies=true');
    expect(confirm.body).toEqual({ email: 'a@example.test', code: '123456' });
  });

  it('puts email sign-in first and Discord after it as the secondary option', () => {
    renderPage('/login', LoginPage, '/login');

    const discord = screen.getByRole('link', { name: 'Sign in with Discord' });
    expect(screen.getByRole('button', { name: 'Sign in' }).compareDocumentPosition(discord)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByLabelText('Email').compareDocumentPosition(discord)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  async function reachCodeStep() {
    renderPage('/login', LoginPage, '/login');
    await signIn('a long passphrase');
    const first = await mock.next('POST', '/api/auth/login?useCookies=true');
    expect(first.body).toEqual({ email: 'a@example.test', password: 'a long passphrase' });
    first.respond(401, { status: 401, title: 'Unauthorized', detail: 'RequiresTwoFactor' });
    return screen.findByLabelText('Authenticator code');
  }

  it('asks for the authenticator code after RequiresTwoFactor and repeats the login with it', async () => {
    const user = userEvent.setup();
    const code = await reachCodeStep();

    expect(code).toHaveAttribute('inputmode', 'numeric');
    await user.type(code, '123 456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const second = await mock.next('POST', '/api/auth/login?useCookies=true');
    expect(second.body).toEqual({
      email: 'a@example.test',
      password: 'a long passphrase',
      twoFactorCode: '123456',
    });
    second.respond(200);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/today'),
    );
  });

  it('shows a turned-down code as a field error on the code step', async () => {
    const user = userEvent.setup();
    await user.type(await reachCodeStep(), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    (await mock.next('POST', '/api/auth/login?useCookies=true')).respond(401, {
      status: 401,
      detail: 'Failed',
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Authenticator code')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByText(/That code didn't work/)).toBeInTheDocument();
  });

  it('sends a recovery code instead when the user switches to it', async () => {
    const user = userEvent.setup();
    await reachCodeStep();

    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText('Recovery code'), 'rc1-synthetic');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const second = await mock.next('POST', '/api/auth/login?useCookies=true');
    expect(second.body).toEqual({
      email: 'a@example.test',
      password: 'a long passphrase',
      twoFactorRecoveryCode: 'rc1-synthetic',
    });
  });

  it('finishes a Discord sign-in on /login?step=2fa through the Discord 2FA endpoint', async () => {
    const user = userEvent.setup();
    const router = renderPage('/login', LoginPage, '/login?step=2fa');

    expect(screen.queryByLabelText('Email')).toBeNull();
    await user.type(screen.getByLabelText('Authenticator code'), '246810');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const finish = await mock.next('POST', '/api/auth/discord/2fa');
    expect(finish.body).toEqual({ code: '246810' });
    finish.respond(204);
    (await mock.next('GET', '/api/auth/antiforgery')).respond(204);
    (await mock.next('GET', '/api/me')).respond(200, me);

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('native: Continue with Discord opens the browser, and the app URL with the code signs in after the second factor', async () => {
    env.native = true;
    const user = userEvent.setup();
    const exchange = vi
      .spyOn(auth, 'loginWithDiscord')
      .mockRejectedValueOnce(new ApiError(401, { status: 401, title: 'Unauthorized', detail: 'RequiresTwoFactor' }))
      .mockResolvedValueOnce(null);
    const router = renderPage('/login', LoginPage, '/login?returnUrl=%2Fhistory');
    expect(screen.queryByRole('button', { name: 'Open Ember on the web' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue with Discord' }));
    await waitFor(() => expect(native.opened).toHaveLength(1));
    expect(native.opened[0]).toMatch(/^\/api\/auth\/discord\/login\?client=native&challenge=[A-Za-z0-9_-]{43}$/);
    await waitFor(() => expect(native.appUrlOpen).not.toBeNull());
    const code = 'C'.repeat(43);
    native.appUrlOpen!({ url: `app.ember.habits://auth/discord?code=${code}` });

    await user.type(await screen.findByLabelText('Authenticator code'), '246810');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/history'));
    expect(exchange).toHaveBeenNthCalledWith(1, { code, verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(exchange).toHaveBeenNthCalledWith(2, exchange.mock.calls[0][0], { code: '246810' });
  });

  it('when Ember could not be reached, offers Try again instead of the form, and the form on request', async () => {
    const user = userEvent.setup();
    const router = renderPage('/login', LoginPage, '/login?returnUrl=%2Fhistory&reason=offline');

    expect(screen.getByRole('heading', { name: "Ember can't be reached right now" })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toHaveFocus();

    router.dispose();
    const retry = renderPage('/login', LoginPage, '/login?returnUrl=%2Fhistory&reason=offline');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry.state.location.pathname).toBe('/history'));
  });

  it('announces a deleted account as a status', () => {
    renderPage('/login', LoginPage, '/login?reason=deleted');

    expect(screen.getByRole('status')).toHaveTextContent(/deleted/);
  });

  it('offers using Ember without an account and goes to /local', async () => {
    const router = renderPage('/login', LoginPage, '/login');

    await userEvent.setup().click(screen.getByRole('link', { name: 'Use Ember without an account' }));

    expect(router.state.location.pathname).toBe('/local');
  });

  it('while device data waits, says it comes along and can go back to no-account mode', async () => {
    localMode.mode.set('upgrading');
    const router = renderPage('/login', LoginPage, '/login');

    expect(screen.getByText("Your habits from this device come along once you've signed in.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Use Ember without an account' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep using Ember without an account' }));

    expect(localMode.cancelUpgrade).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });
});
