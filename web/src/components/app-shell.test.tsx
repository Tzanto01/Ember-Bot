import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceSync, offlineQueue } from '@/lib/services';
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
});
