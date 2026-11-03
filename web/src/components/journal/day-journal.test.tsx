import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/lib/services';
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

  it('shows only the way to unlock while the private journal is locked', async () => {
    const journal = fakeJournal({ state: 'locked', notes: [{ date: '2026-11-01', text: 'Secret', mood: 'meh' }] });
    renderWithJournal(<DayJournal date="2026-11-01" />, journal);

    expect(screen.getByText('Your private journal is locked on this device.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unlock it in Settings' })).toHaveAttribute('href', '/settings#journal');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(journal.notes).not.toHaveBeenCalled();
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
