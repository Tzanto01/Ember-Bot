import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeJournal, renderWithJournal } from './fake-journal';
import { MoodManager } from './mood-manager';

describe('MoodManager', { timeout: 15_000 }, () => {
  it('adds an own mood with its emoji', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    renderWithJournal(<MoodManager />, journal);

    await screen.findByText('No own moods yet.');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Cozy ');
    await user.type(screen.getByRole('textbox', { name: /Emoji/ }), '🫖');
    await user.click(screen.getByRole('button', { name: 'Add mood' }));

    expect(journal.addMood).toHaveBeenCalledWith({ label: 'Cozy', emoji: '🫖' });
    expect(await screen.findByRole('button', { name: 'Archive Cozy' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  });

  it('focuses the name when Change opens the form', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ moods: [{ id: 4, label: 'Cozy', emoji: null, archived: false }] });
    renderWithJournal(<MoodManager />, journal);

    await user.click(await screen.findByRole('button', { name: 'Change Cozy' }));

    expect(screen.getByRole('form', { name: 'Change Cozy' })).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toHaveValue('Cozy');
  });

  it('rejects two emoji', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal();
    renderWithJournal(<MoodManager />, journal);

    await screen.findByText('No own moods yet.');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Cozy');
    await user.type(screen.getByRole('textbox', { name: /Emoji/ }), '🫖🌙');
    await user.click(screen.getByRole('button', { name: 'Add mood' }));

    expect(screen.getByRole('textbox', { name: /Emoji/ })).toHaveAccessibleDescription(
      'Use a single emoji, or leave this empty.',
    );
    expect(journal.addMood).not.toHaveBeenCalled();
  });

  it('archives a mood and offers to bring it back', async () => {
    const user = userEvent.setup();
    const journal = fakeJournal({ moods: [{ id: 4, label: 'Cozy', emoji: null, archived: false }] });
    renderWithJournal(<MoodManager />, journal);

    await user.click(await screen.findByRole('button', { name: 'Archive Cozy' }));

    expect(journal.updateMood).toHaveBeenCalledWith(4, { archived: true });
    expect(await screen.findByRole('button', { name: 'Unarchive Cozy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unarchive Cozy' })).toHaveFocus());
  });
});
