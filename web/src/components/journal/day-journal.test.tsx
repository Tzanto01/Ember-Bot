import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    await user.click(await screen.findByRole('radio', { name: 'Low' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Saved on this device, it'll sync when you're back online.")).toBeInTheDocument();
  });

  it('says saved once the queued entry has synced', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    journal.save.mockResolvedValue({ queued: true });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    await user.click(await screen.findByRole('radio', { name: 'Low' }));
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
});
