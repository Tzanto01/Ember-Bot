import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceSync, offlineQueue } from '@/lib/services';
import { AppShell } from './app-shell';

function renderShell() {
  const router = createMemoryRouter([
    { path: '/', Component: AppShell, children: [{ index: true, element: <h1>Today</h1> }] },
  ]);
  render(<RouterProvider router={router} />);
  return screen.findByRole('heading', { name: 'Today' });
}

describe('AppShell', () => {
  afterEach(() => {
    offlineQueue.pending.set(0);
    deviceSync.dropped.set(0);
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
