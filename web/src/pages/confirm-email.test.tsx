import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { type FetchMock, mockFetch } from '@/lib/test-support';
import ConfirmEmailPage from './confirm-email';

describe('ConfirmEmailPage', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('on a 401 explains it as a form problem with a reset link and offers a new link', async () => {
    renderPage('/confirm-email', ConfirmEmailPage, '/confirm-email?userId=u1&code=c0de-123');

    (await confirmWith('wrong phrase')).respond(401, { status: 401, title: 'Unauthorized' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("That link or password didn't work.");
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByLabelText('Email for a new link')).toBeInTheDocument();
  });
});
