import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type JournalApi, JournalLockedError } from '@/lib/journal/types';
import { auth, offlineQueue } from '@/lib/services';
import { me } from '@/lib/test-support';
import { DayJournal } from './day-journal';
import { fakeJournal, renderWithJournal } from './fake-journal';

describe('DayJournal', { timeout: 15_000 }, () => {
  beforeEach(() => auth.setMe({ ...me, localToday: '2026-11-01' }));
  afterEach(() => auth.clearSession());

  it('saves the trimmed text with its line breaks and the chosen mood', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.click(await screen.findByRole('radio', { name: 'Good' }));
    await user.type(screen.getByRole('textbox', { name: /A few words/ }), '  Slept badly.{Enter}Still walked.  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(journal.save).toHaveBeenCalledWith('2026-11-01', { text: 'Slept badly.\nStill walked.', mood: 'good' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('shows Saved in place of Save once saved, focused, and brings Save back after an edit', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    const textbox = await screen.findByRole('textbox', { name: /A few words/ });
    await user.type(textbox, 'Walked.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const status = (await screen.findByText('Saved')).closest('[role="status"]');
    expect(status).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    await user.type(textbox, ' Twice.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
  });

  it('shows a stored entry as saved on a fresh mount, and Save once the form differs from it', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ notes: [{ date: '2026-10-30', text: 'Tired.', mood: 'okay' }] });
    renderWithJournal(<DayJournal date="2026-10-30" />, journal);

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear mood' }));
    expect(await screen.findByText('Mood cleared')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText(/Saved|cleared/)).toBeNull();
  });

  it('keeps Save for an empty day', async () => {
    const journal = fakeJournal();
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('deletes the entry when text and mood are both cleared', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ notes: [{ date: '2026-10-30', text: 'Tired.', mood: 'okay' }] });
    renderWithJournal(<DayJournal date="2026-10-30" />, journal);

    expect(await screen.findByRole('textbox', { name: /A few words/ })).toHaveValue('Tired.');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(journal.save).toHaveBeenCalledWith('2026-10-30', { text: null, mood: null });
  });

  it('blocks text longer than 2000 characters with a message', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.click(await screen.findByRole('textbox', { name: /A few words/ }));
    await user.paste('a'.repeat(2001));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('textbox', { name: /A few words/ })).toHaveAccessibleDescription(
      expect.stringContaining('Keep it to 2000 characters or fewer.'),
    );
    expect(journal.save).not.toHaveBeenCalled();
  });

  it('says the entry waits on this device when the save was queued offline', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    journal.save.mockResolvedValue({ queued: true });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.type(await screen.findByRole('textbox', { name: /A few words/ }), 'Rested.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Saved on this device, it'll sync when you're back online.")).toBeInTheDocument();
  });

  it('says saved once the queued entry has synced', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    journal.save.mockResolvedValue({ queued: true });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.type(await screen.findByRole('textbox', { name: /A few words/ }), 'Rested.');
    act(() => offlineQueue.pending.set(1));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument();

    act(() => offlineQueue.pending.set(0));
    expect(screen.queryByText(/Saved on this device/)).toBeNull();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('shows only the way to unlock while the private journal is locked', async () => {
    const journal = fakeJournal({ state: 'locked', notes: [{ date: '2026-11-01', text: 'Secret', mood: 'meh' }] });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    expect(screen.getByText('Your private journal is locked on this device.')).toBeInTheDocument();
    expect(screen.getByLabelText('Journal passphrase')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /A few words/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(journal.notes).not.toHaveBeenCalled();
  });

  it('unlocks in place with the passphrase and then shows the day', async () => {
    const user = userEvent.setup();
    const base = fakeJournal({ state: 'locked', notes: [{ date: '2026-11-01', text: 'Secret', mood: 'meh' }] });
    const journal = {
      ...base,
      unlock: vi.fn(async () => {
        base.state.set('unlocked');
        return { needsNewPassphrase: false };
      }),
    };
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.type(screen.getByLabelText('Journal passphrase'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(journal.unlock).toHaveBeenCalledWith({ passphrase: 'correct horse battery' }, false);
    expect(await screen.findByRole('textbox', { name: /A few words/ })).toHaveValue('Secret');
  });

  it('asks for a new passphrase in place after unlocking with the recovery code', async () => {
    const user = userEvent.setup();
    const base = fakeJournal({ state: 'locked' });
    const journal = {
      ...base,
      unlock: vi.fn(async () => {
        base.state.set('unlocked');
        return { needsNewPassphrase: true };
      }),
    };
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.click(screen.getByRole('button', { name: 'Use my recovery code' }));
    await user.type(screen.getByLabelText('Recovery code'), 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('button', { name: 'Save new passphrase' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /A few words/ })).not.toBeInTheDocument();
  });

  it('saves a tapped mood right away with the saved text, leaving unsaved text for Save', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ notes: [{ date: '2026-11-01', text: 'Walked.', mood: null }] });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.type(await screen.findByRole('textbox', { name: /A few words/ }), ' Slept.');
    await user.click(screen.getByRole('radio', { name: 'Great' }));

    expect(journal.save).toHaveBeenCalledWith('2026-11-01', { text: 'Walked.', mood: 'great' });
    expect(await screen.findByText('Mood saved')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /A few words/ })).toHaveValue('Walked. Slept.');
    expect(screen.getByRole('radio', { name: 'Great' })).toHaveAttribute('aria-checked', 'true');
  });

  it('clears the mood right away and moves focus to the first mood', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ notes: [{ date: '2026-11-01', text: null, mood: 'good' }] });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.click(await screen.findByRole('button', { name: 'Clear mood' }));

    expect(journal.save).toHaveBeenCalledWith('2026-11-01', { text: null, mood: null });
    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
  });

  it("keeps a day's archived mood but doesn't offer it for other days", async () => {
    const journal = fakeJournal({
      notes: [{ date: '2026-11-01', text: null, mood: 'custom:3' }],
      moods: [{ id: 3, label: 'Cozy', emoji: '🫖', archived: true }],
    });
    renderWithJournal(
      <>
        <DayJournal date="2026-11-01" />
        <DayJournal date="2026-10-31" />
      </>,
      journal,
    );

    const today = (await screen.findByRole('heading', { name: 'How was today?' })).parentElement!;
    expect(await within(today).findByRole('radio', { name: /Cozy/ })).toBeChecked();
    const before = screen.getByRole('heading', { name: /^How was Saturday.*31/ }).parentElement!;
    await within(before).findByRole('radio', { name: 'Great' });
    expect(within(before).queryByRole('radio', { name: /Cozy/ })).not.toBeInTheDocument();
  });

  it('keeps newer text saved elsewhere when only the mood is tapped', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ notes: [{ date: '2026-11-01', text: 'Walked.', mood: null }] });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);
    expect(await screen.findByRole('textbox', { name: /A few words/ })).toHaveValue('Walked.');
    journal.notes.mockResolvedValue({ notes: [{ date: '2026-11-01', text: 'Walked and swam.', mood: null }], hidden: 0 });

    await user.click(screen.getByRole('radio', { name: 'Great' }));

    expect(journal.save).toHaveBeenCalledWith('2026-11-01', { text: 'Walked and swam.', mood: 'great' });
    expect(await screen.findByRole('textbox', { name: /A few words/ })).toHaveValue('Walked and swam.');
  });

  async function unlockWithRecoveryCode(journal: JournalApi) {
    const user = userEvent.setup();
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);
    await user.click(screen.getByRole('button', { name: 'Use my recovery code' }));
    await user.type(screen.getByLabelText('Recovery code'), 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    return user;
  }

  function recoveryJournal() {
    const base = fakeJournal({ state: 'locked' });
    return {
      ...base,
      unlock: vi.fn(async () => {
        base.state.set('unlocked');
        return { needsNewPassphrase: true };
      }),
      setPassphrase: vi.fn(async () => Promise.reject(new JournalLockedError())),
      forget: vi.fn(async () => base.state.set('locked')),
    };
  }

  it('locks again with the same message as Settings when choosing the new passphrase took too long', async () => {
    const journal = recoveryJournal();
    const user = await unlockWithRecoveryCode(journal);

    await user.type(await screen.findByLabelText('New passphrase'), 'warm kettle morning');
    await user.type(screen.getByLabelText('Type it again'), 'warm kettle morning');
    await user.type(screen.getByLabelText('Your login password'), 'synthetic-login-1');
    await user.click(screen.getByRole('button', { name: 'Save new passphrase' }));

    expect(journal.forget).toHaveBeenCalled();
    expect(
      await screen.findByText('That took a while, so the journal locked again. Unlock it with your recovery code once more.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How was today?' })).toHaveFocus();
  });

  it('skips the new passphrase while the journal is being turned off', async () => {
    const journal = recoveryJournal();
    journal.turningOff.set(true);
    await unlockWithRecoveryCode(journal);

    expect(await screen.findByRole('textbox', { name: /A few words/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save new passphrase' })).toBeNull();
  });

  it('moves focus to the card heading and says so after unlocking', async () => {
    const user = userEvent.setup();
    const base = fakeJournal({ state: 'locked' });
    const journal = {
      ...base,
      unlock: vi.fn(async () => {
        base.state.set('unlocked');
        return { needsNewPassphrase: false };
      }),
    };
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.type(screen.getByLabelText('Journal passphrase'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText('Unlocked on this device.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How was today?' })).toHaveFocus();
  });
});
