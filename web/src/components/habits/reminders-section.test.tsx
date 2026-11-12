import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { reminders } from '@/lib/services';
import type { ReminderChannel } from '@/lib/models';
import { type ReminderChoice, RemindersSection } from './habit-edit-sections';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('local'), evicted: new Store(false) },
    reminders: { requestPermission: vi.fn(async () => true) },
  };
});

function renderSection(channels: ReminderChannel[], save = vi.fn(async (_choice: ReminderChoice) => {})) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <RemindersSection subject="habit" channels={channels} exclusions={[]} hasReminderTime save={save} />,
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return save;
}

describe('RemindersSection without an account', () => {
  afterEach(() => {
    env.native = false;
    localStorage.clear();
  });

  it('on the web, offers no channel and says reminders need the app or an account', () => {
    renderSection([]);

    expect(screen.getByText('Reminders need the Ember app or an account.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('in the app, offers only "Remind me on this phone" and turning it off saves no channels', async () => {
    env.native = true;
    const save = renderSection(['mobile']);

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Remind me on this phone' }));

    expect(save).toHaveBeenCalledWith({ reminderChannels: [] });
  });

  it('in the app, turning the phone on asks for notifications first and saves the phone channel', async () => {
    env.native = true;
    const requestPermission = vi.mocked(reminders!.requestPermission);
    const save = renderSection([]);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Remind me on this phone' }));

    expect(requestPermission).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ reminderChannels: ['mobile'] });
    expect(await screen.findByText('This phone will remind you.')).toBeInTheDocument();
  });
});
