import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { api } from '@/lib/services';
import { mockFetch } from '@/lib/test-support';
import SignupPage from './signup';

describe('SignupPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
