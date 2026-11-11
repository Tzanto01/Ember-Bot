import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from '@/lib/services';
import { updateReady } from '@/lib/startup';
import { UpdateToast } from './update-toast';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => () => undefined }));

describe('UpdateToast', () => {
  afterEach(() => {
    updateReady.set(null);
    http.offlineData.set(false);
  });

  it('offers a reload when a new version waits, and can be dismissed', async () => {
    const reload = vi.fn();
    render(<UpdateToast />);
    expect(screen.queryByText('A new version is ready.')).toBeNull();

    act(() => updateReady.set(reload));
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reloading…' }));
    expect(reload).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('A new version is ready.')).toBeNull();
  });

  it('says the habits on screen come from this device while offline', () => {
    render(<UpdateToast />);

    act(() => http.offlineData.set(true));
    expect(screen.getByRole('status')).toHaveTextContent("You're offline, so this is what Ember saved on this device.");

    act(() => http.offlineData.set(false));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
