import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceSync, localMode, offlineQueue } from '@/lib/services';
import { mockFetch } from '@/lib/test-support';
import { AppShell } from './app-shell';

function renderShell() {
  const router = createMemoryRouter([
    { path: '/', Component: AppShell, children: [{ index: true, element: <h1>Today</h1> }] },
    { path: '*', element: <h1>Elsewhere</h1> },
  ]);
  render(<RouterProvider router={router} />);
  return screen.findByRole('heading', { name: 'Today' });
}

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    offlineQueue.pending.set(0);
    deviceSync.dropped.set(0);
    localMode.mode.set('account');
  });

  it('says it could not sign out and stays when the server cannot end the session', async () => {
    const f = mockFetch();
    await renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    (await f.next('POST', '/api/auth/logout')).respond(503);

    expect(
      await screen.findByText("Ember couldn't sign you out. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('has Today, History and Settings in the main nav, with the year view inside History', async () => {
    await renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Today', 'History', 'Settings']);
  });

  it('offers "Sign out" with an account or mid-upgrade but not in no-account mode', async () => {
    await renderShell();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    act(() => localMode.mode.set('local'));
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    act(() => localMode.mode.set('upgrading'));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('offers "Sign in" in no-account mode, keeping the device data for the account it opens', async () => {
    const beginUpgrade = vi.spyOn(localMode, 'beginUpgrade').mockResolvedValue();
    localMode.mode.set('local');
    await renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(beginUpgrade).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    beginUpgrade.mockRestore();
  });

  it('stays and says so when no-account mode cannot start the move to an account', async () => {
    const beginUpgrade = vi.spyOn(localMode, 'beginUpgrade').mockRejectedValue(new Error('offline'));
    localMode.mode.set('local');
    await renderShell();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't work just now.");
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    beginUpgrade.mockRestore();
  });

  it('shows the offline notice while edits are queued, with singular and plural copy, and drops it after sync', async () => {
    await renderShell();
    expect(screen.queryByText(/saved on this device/)).toBeNull();

    act(() => offlineQueue.pending.set(1));
    expect(
      screen.getByText("One change is saved on this device and will sync when you're back online."),
    ).toBeInTheDocument();

    act(() => offlineQueue.pending.set(3));
    expect(
      screen.getByText("3 changes are saved on this device and will sync when you're back online."),
    ).toBeInTheDocument();

    act(() => offlineQueue.pending.set(0));
    expect(screen.queryByText(/saved on this device/)).toBeNull();
  });

  it('shows the dropped-edit notice as an alert until "Okay" dismisses it', async () => {
    await renderShell();
    act(() => deviceSync.dropped.set(1));

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't be saved/);

    await userEvent.click(screen.getByRole('button', { name: 'Okay' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(deviceSync.dropped.get()).toBe(0);
  });

  it('shows the text of a journal entry that could not be saved so it can be copied', async () => {
    await renderShell();
    act(() => offlineQueue.droppedNotes.set([{ date: '2026-11-01', text: 'Walked by the river.\nFelt calm.' }]));

    expect(screen.getByRole('alert')).toHaveTextContent('Walked by the river.');

    await userEvent.click(screen.getByRole('button', { name: 'Okay' }));

    expect(offlineQueue.droppedNotes.get()).toEqual([]);
  });
});
