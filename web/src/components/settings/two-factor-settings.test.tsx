import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeJournal, renderWithJournal } from '@/components/journal/fake-journal';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import { TwoFactorSettings } from './two-factor-settings';

const codes = Array.from({ length: 10 }, (_, i) => `rc${i}-synthetic`);

async function open(status: { enabled: boolean; recoveryCodesLeft: number }, account = me) {
  const fetch = mockFetch();
  renderWithJournal(<TwoFactorSettings me={account} />, fakeJournal());
  (await fetch.next('GET', '/api/me/2fa')).respond(200, status);
  return fetch;
}

async function startSetup(fetch: FetchMock) {
  await userEvent.click(await screen.findByRole('button', { name: 'Set up two-step sign-in' }));
  (await fetch.next('POST', '/api/me/2fa/setup')).respond(200, {
    sharedKey: 'abcd efgh ijkl mnop',
    authenticatorUri: 'otpauth://totp/Ember:a%40example.test?secret=ABCDEFGHIJKLMNOP&issuer=Ember',
  });
}

describe('TwoFactorSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets up with the shared key in groups and a named QR code drawn as SVG', async () => {
    const fetch = await open({ enabled: false, recoveryCodesLeft: 0 });
    await startSetup(fetch);

    const qr = await screen.findByRole('img', {
      name: 'QR code for adding Ember to your authenticator app',
    });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(screen.getByText('ABCD EFGH IJKL MNOP')).toBeInTheDocument();
    expect(screen.getByLabelText('Code from your authenticator app')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    );
  });

  it('enables with the typed code and shows the ten recovery codes only until they are saved', async () => {
    const user = userEvent.setup();
    const fetch = await open({ enabled: false, recoveryCodesLeft: 0 });
    await startSetup(fetch);

    await user.type(await screen.findByLabelText('Code from your authenticator app'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    const enable = await fetch.next('POST', '/api/me/2fa/enable');
    expect(enable.body).toEqual({ code: '123456' });
    enable.respond(200, { recoveryCodes: codes });

    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(list.querySelectorAll('li')).toHaveLength(10);
    expect(screen.getByText(/each works once/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "I've saved them" }));
    expect(screen.queryByText(codes[0]!)).toBeNull();
    expect(screen.getByText(/You have 10 recovery codes left/)).toBeInTheDocument();
  });

  it('shows a turned-down code as a field error and stays on the step', async () => {
    const user = userEvent.setup();
    const fetch = await open({ enabled: false, recoveryCodesLeft: 0 });
    await startSetup(fetch);

    await user.type(await screen.findByLabelText('Code from your authenticator app'), '000000');
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    (await fetch.next('POST', '/api/me/2fa/enable')).respond(400, {
      status: 400,
      errors: { code: ['Invalid'] },
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Code from your authenticator app')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(screen.getByText(/That code didn't work/)).toBeInTheDocument();
  });

  it('turns off with a current code for an account without a password', async () => {
    const user = userEvent.setup();
    const fetch = await open(
      { enabled: true, recoveryCodesLeft: 4 },
      { ...me, hasPassword: false, email: null },
    );

    await user.click(await screen.findByRole('button', { name: 'Turn off two-step sign-in' }));
    expect(screen.queryByLabelText('Your password')).toBeNull();
    await user.type(screen.getByLabelText('Code from your authenticator app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Turn off two-step sign-in' }));

    const disable = await fetch.next('POST', '/api/me/2fa/disable');
    expect(disable.body).toEqual({ code: '654321' });
    disable.respond(204);
    expect(await screen.findByText(/Two-step sign-in is off/)).toBeInTheDocument();
  });
});
