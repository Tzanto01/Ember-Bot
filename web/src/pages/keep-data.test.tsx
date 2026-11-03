import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveExport } from '@/lib/native/save-file';
import { auth, backup, localMode, upgrade } from '@/lib/services';
import { me } from '@/lib/test-support';
import { renderPage } from '@/test-utils';
import KeepDataPage from './keep-data';

vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: {
      mode: new Store('upgrading'),
      evicted: new Store(false),
      cancelUpgrade: vi.fn(async () => {}),
      finishUpgrade: vi.fn(async () => {}),
    },
    upgrade: { summary: vi.fn(), run: vi.fn() },
    backup: { exportBackup: vi.fn(async () => ({})), markBackedUp: vi.fn(async () => {}) },
  };
});
vi.mock('@/lib/native/save-file', () => ({ saveExport: vi.fn(async () => true) }));

const summary = { habits: 12, checkIns: 340, notes: 8, moods: 0 };

async function open() {
  const router = renderPage('/keep-data', KeepDataPage, '/keep-data');
  expect(await screen.findByText('12 habits, 340 check-ins, 8 journal entries')).toBeInTheDocument();
  return router;
}

describe('KeepDataPage', () => {
  beforeEach(() => {
    auth.setMe(me);
    vi.mocked(upgrade.summary).mockResolvedValue(summary);
  });

  afterEach(() => {
    auth.clearSession();
    vi.clearAllMocks();
  });

  it('moves the data without a private journal and goes to Today, once even when pressed twice', async () => {
    let finish = () => {};
    vi.mocked(upgrade.run).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ ok: true, recoveryCode: null }))),
    );
    const user = userEvent.setup();
    const router = await open();

    await user.click(screen.getByRole('button', { name: 'Move my data' }));
    await user.click(screen.getByRole('button', { name: /Moving your data/ }));
    finish();

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(upgrade.run).toHaveBeenCalledOnce();
    expect(upgrade.run).toHaveBeenCalledWith(undefined);
  });

  it('encrypts the journal with the chosen passphrase and shows the recovery code once', async () => {
    vi.mocked(upgrade.run).mockResolvedValue({ ok: true, recoveryCode: 'ABCD-EFGH-IJKL' });
    const user = userEvent.setup();
    const router = await open();

    await user.click(screen.getByRole('checkbox', { name: 'Keep my journal private (end-to-end encrypted)' }));
    await user.type(screen.getByLabelText('Journal passphrase'), 'a calm long phrase');
    await user.type(screen.getByLabelText('Type it again'), 'a calm long phrase');
    await user.type(screen.getByLabelText('Your login password'), 'login secret');
    await user.click(screen.getByRole('button', { name: 'Move my data' }));

    expect(upgrade.run).toHaveBeenCalledWith({
      privateJournal: { passphrase: 'a calm long phrase', remember: false, password: 'login secret' },
    });
    expect(await screen.findByText('ABCD EFGH IJKL')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/keep-data');

    await user.click(screen.getByRole('checkbox', { name: "I've saved my recovery code" }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(screen.queryByText('ABCD EFGH IJKL')).toBeNull();
  });

  it('does not move anything while the passphrases differ', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getByRole('checkbox', { name: 'Keep my journal private (end-to-end encrypted)' }));
    await user.type(screen.getByLabelText('Journal passphrase'), 'a calm long phrase');
    await user.type(screen.getByLabelText('Type it again'), 'a different phrase');
    await user.type(screen.getByLabelText('Your login password'), 'login secret');
    await user.click(screen.getByRole('button', { name: 'Move my data' }));

    expect(await screen.findByText("The two passphrases don't match yet.")).toBeInTheDocument();
    expect(upgrade.run).not.toHaveBeenCalled();
  });

  it('on an account that already has habits, offers another account or staying without one', async () => {
    vi.mocked(upgrade.run).mockResolvedValue({
      ok: false,
      reason: 'conflict',
      message: 'This account already has habits, so nothing was moved.',
    });
    const user = userEvent.setup();
    const router = await open();

    await user.click(screen.getByRole('button', { name: 'Move my data' }));

    expect(await screen.findByRole('heading', { name: 'This account already has habits' })).toBeInTheDocument();
    expect(screen.getByText('This account already has habits, so nothing was moved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a different account' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep using Ember without an account' }));

    expect(localMode.cancelUpgrade).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('shows a failed move and lets the user try again', async () => {
    vi.mocked(upgrade.run)
      .mockResolvedValueOnce({ ok: false, reason: 'failed', message: "Your data didn't move this time." })
      .mockResolvedValueOnce({ ok: true, recoveryCode: null });
    const user = userEvent.setup();
    const router = await open();

    await user.click(screen.getByRole('button', { name: 'Move my data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Your data didn't move this time.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(upgrade.run).toHaveBeenCalledTimes(2);
  });

  it('with nothing waiting, Continue finishes the upgrade before going to Today', async () => {
    vi.mocked(upgrade.summary).mockResolvedValue(null);
    const router = renderPage('/keep-data', KeepDataPage, '/keep-data');

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue' }));

    expect(localMode.finishUpgrade).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });

  it('says which entries stay behind and records a backup only once it was saved', async () => {
    vi.mocked(upgrade.summary).mockResolvedValue({ ...summary, leftOut: { notes: 3, lowDays: 1 } });
    vi.mocked(saveExport).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    await open();

    expect(
      screen.getByText(
        "3 journal entries and 1 low day from before your first habit can't be moved to the account. They stay in your device backup.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export backup first' }));
    expect(saveExport).toHaveBeenCalledOnce();
    expect(backup.markBackedUp).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Export backup first' }));

    expect(await screen.findByText('Backup saved.')).toBeInTheDocument();
    expect(backup.markBackedUp).toHaveBeenCalledOnce();
  });
});
