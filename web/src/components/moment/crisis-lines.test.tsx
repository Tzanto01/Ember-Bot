import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrisisLines } from './crisis-lines';

afterEach(() => vi.restoreAllMocks());

describe('CrisisLines', () => {
  it('dials digits-only tel: links and swaps lines on a country change without storing anything', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<CrisisLines />);

    const lines = screen.getByRole('list', { name: 'Crisis lines' });
    expect(
      within(lines).getByRole('link', { name: 'Call TelefonSeelsorge, 0800 111 0 111' }),
    ).toHaveAttribute('href', 'tel:08001110111');
    expect(within(lines).getByRole('link', { name: 'Call Emergency number (EU), 112' })).toHaveAttribute(
      'href',
      'tel:112',
    );
    expect(
      screen.getByText("Ember isn't a crisis service and doesn't read what you write."),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Where are you?'), 'United Kingdom');

    expect(within(lines).getByRole('link', { name: 'Call Samaritans, 116 123' })).toHaveAttribute(
      'href',
      'tel:116123',
    );
    expect(within(lines).queryByRole('link', { name: /TelefonSeelsorge/ })).not.toBeInTheDocument();
    expect(within(lines).queryByRole('link', { name: /112/ })).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
  });
});
