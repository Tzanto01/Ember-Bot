import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeJournal, renderWithJournal } from '@/components/journal/fake-journal';
import { type JournalApi, type JournalState, WrongSecretError } from '@/lib/journal/types';
import { me } from '@/lib/test-support';
import { JournalSettings } from './journal-settings';

const recoveryCode = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';

function setup(state: JournalState) {
  const journal = {
    ...fakeJournal({ state }),
    enable: vi.fn<JournalApi['enable']>(),
    unlock: vi.fn<JournalApi['unlock']>(),
    setPassphrase: vi.fn<JournalApi['setPassphrase']>(),
    disable: vi.fn<JournalApi['disable']>(),
  };
  renderWithJournal(
    <JournalSettings me={{ ...me, journal: { encrypted: state !== 'off', plaintextLeft: 0 } }} />,
    journal,
  );
  return { journal, user: userEvent.setup() };
}

describe('JournalSettings', () => {
  it('turns on only with matching passphrases and, for a password account, the login password', async () => {
    const { journal, user } = setup('off');
    journal.enable.mockResolvedValue({ recoveryCode });
    const submit = () =>
      user.click(screen.getByRole('button', { name: 'Turn on the private journal' }));

    await user.type(await screen.findByLabelText('Journal passphrase'), 'quiet evening lamp');
    await user.type(screen.getByLabelText('Type it again'), 'quiet evening lamb');
    await submit();
    expect(screen.getByText("The two passphrases don't match yet.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), 'quiet evening lamp');
    await submit();
    expect(screen.getByText('Please enter your login password.')).toBeInTheDocument();
    expect(journal.enable).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Your login password'), 'synthetic-login-1');
    await submit();
    expect(journal.enable).toHaveBeenCalledWith('quiet evening lamp', false, 'synthetic-login-1');
  });

  it('shows the recovery code once and finishes only after "saved" is ticked', async () => {
    const { journal, user } = setup('off');
    journal.enable.mockImplementation(async () => {
      journal.state.set('unlocked');
      return { recoveryCode };
    });

    await user.type(await screen.findByLabelText('Journal passphrase'), 'quiet evening lamp');
    await user.type(screen.getByLabelText('Type it again'), 'quiet evening lamp');
    await user.type(screen.getByLabelText('Your login password'), 'synthetic-login-1');
    await user.click(screen.getByRole('button', { name: 'Turn on the private journal' }));

    expect(await screen.findByText('ABCD EFGH JKMN PQRS TVWX YZ01 2345 6789')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText(/Tick this once your recovery code/)).toBeInTheDocument();
    expect(screen.getByText('ABCD EFGH JKMN PQRS TVWX YZ01 2345 6789')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: "I've saved my recovery code" }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.queryByText('ABCD EFGH JKMN PQRS TVWX YZ01 2345 6789')).toBeNull();
    expect(screen.getByText('Your private journal is ready.')).toBeInTheDocument();
  });

  it('shows a wrong passphrase as a gentle field error and stays locked', async () => {
    const { journal, user } = setup('locked');
    journal.unlock.mockRejectedValue(new WrongSecretError());

    await user.type(await screen.findByLabelText('Journal passphrase'), 'not the passphrase');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(journal.unlock).toHaveBeenCalledWith({ passphrase: 'not the passphrase' }, false);
    await waitFor(() =>
      expect(screen.getByLabelText('Journal passphrase')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByText(/That passphrase doesn't open your journal/)).toBeInTheDocument();
  });

  it('after a recovery-code unlock asks for a new passphrase before anything else', async () => {
    const { journal, user } = setup('locked');
    journal.unlock.mockImplementation(async () => {
      journal.state.set('unlocked');
      return { needsNewPassphrase: true };
    });
    journal.setPassphrase.mockResolvedValue(undefined);

    await user.click(await screen.findByRole('button', { name: 'Use my recovery code' }));
    await user.type(screen.getByLabelText('Recovery code'), recoveryCode);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(journal.unlock).toHaveBeenCalledWith({ recoveryCode }, false);
    await user.type(await screen.findByLabelText('New passphrase'), 'warm kettle morning');
    expect(screen.queryByRole('button', { name: 'Change passphrase' })).toBeNull();
    await user.type(screen.getByLabelText('Type it again'), 'warm kettle morning');
    await user.type(screen.getByLabelText('Your login password'), 'synthetic-login-1');
    await user.click(screen.getByRole('button', { name: 'Save new passphrase' }));

    expect(journal.setPassphrase).toHaveBeenCalledWith('warm kettle morning', 'synthetic-login-1');
    expect(await screen.findByRole('button', { name: 'Change passphrase' })).toBeInTheDocument();
  });

  it('turns the private journal off with the login password', async () => {
    const { journal, user } = setup('unlocked');
    journal.disable.mockImplementation(async () => journal.state.set('off'));

    await user.click(await screen.findByRole('button', { name: 'Turn off the private journal' }));
    await user.type(screen.getByLabelText('Your login password'), 'synthetic-login-1');
    await user.click(screen.getByRole('button', { name: 'Turn off the private journal' }));

    expect(journal.disable).toHaveBeenCalledWith('synthetic-login-1');
    expect(await screen.findByText(/The private journal is off/)).toBeInTheDocument();
  });
});
