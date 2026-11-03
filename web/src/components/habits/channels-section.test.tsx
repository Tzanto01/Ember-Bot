import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import type { ReminderChannel } from '@/lib/models';
import { ChannelsSection } from './habit-edit-sections';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('local'), evicted: new Store(false) },
    reminders: { requestPermission: vi.fn(async () => true) },
  };
});

function renderSection(channels: ReminderChannel[], save = vi.fn(async (_next: ReminderChannel[]) => {})) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ChannelsSection subject="habit" channels={channels} memoryKey="k" hasReminderTime save={save} />,
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

describe('ChannelsSection without an account', () => {
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
    localStorage.setItem('k', JSON.stringify(['discord']));
    const save = renderSection(['mobile']);

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Remind me on this phone' }));

    expect(save).toHaveBeenCalledWith([]);
  });
});
