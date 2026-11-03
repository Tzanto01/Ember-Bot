import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedBackup } from '@/lib/local/types';
import { saveExport } from '@/lib/native/save-file';
import { backup } from '@/lib/services';
import { DeviceDataSettings } from './device-data-settings';

vi.mock('@/lib/services', async () => {
  const { Store } = await import('@/lib/store');
  return {
    auth: { loadMe: vi.fn(async () => null) },
    localMode: { mode: new Store('local'), evicted: new Store(false), beginUpgrade: vi.fn() },
    backup: {
      exportBackup: vi.fn(async () => ({})),
      markBackedUp: vi.fn(async () => {}),
      parseBackup: vi.fn(),
      restoreBackup: vi.fn(async () => {}),
    },
  };
});
vi.mock('@/lib/native/save-file', () => ({ saveExport: vi.fn(async () => true) }));

const parsed = {
  summary: { habits: 3, checkIns: 40, lowDays: 2, routines: 1, notes: 5, moods: 1, skippedEncrypted: 4 },
  data: {},
} as unknown as ParsedBackup;

function renderCard() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const router = createMemoryRouter([{ path: '/settings', element: <DeviceDataSettings /> }], {
    initialEntries: ['/settings'],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function chooseBackup(text = '{"format_version":2}') {
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText('Choose a backup file'),
    new File([text], 'ember-backup.json', { type: 'application/json' }),
  );
  return user;
}

describe('DeviceDataSettings', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows what the backup holds and restores only after "Replace my data"', async () => {
    vi.mocked(backup.parseBackup).mockReturnValue(parsed);
    const { invalidate } = renderCard();

    const user = await chooseBackup();

    expect(backup.parseBackup).toHaveBeenCalledWith('{"format_version":2}');
    const confirm = screen.getByRole('group', { name: "Replace what's on this device?" });
    expect(confirm).toHaveTextContent(
      '3 habits, 40 check-ins, 2 low days, 1 routine, 5 journal entries and 1 mood. Restoring it replaces everything on this device now.',
    );
    expect(confirm).toHaveTextContent(/4 private journal entries and moods in it .* left out/);
    expect(screen.getByRole('heading', { name: "Replace what's on this device?" })).toHaveFocus();
    expect(backup.restoreBackup).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Replace my data' }));

    expect(backup.restoreBackup).toHaveBeenCalledWith(parsed);
    expect(invalidate).toHaveBeenCalled();
    expect(await screen.findByText('Backup restored.')).toHaveFocus();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('restores nothing when the confirmation is cancelled', async () => {
    vi.mocked(backup.parseBackup).mockReturnValue(parsed);
    renderCard();

    const user = await chooseBackup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Import backup' })).toHaveFocus();
    expect(backup.restoreBackup).not.toHaveBeenCalled();
  });

  it('shows the parse error and offers no restore', async () => {
    vi.mocked(backup.parseBackup).mockReturnValue({ error: "This file isn't an Ember backup." });
    renderCard();

    await chooseBackup('not json');

    expect(await screen.findByRole('alert')).toHaveTextContent("This file isn't an Ember backup.");
    expect(screen.queryByRole('button', { name: 'Replace my data' })).toBeNull();
  });

  it('turns down a file over 5 MiB without reading it', async () => {
    renderCard();

    await chooseBackup('x'.repeat(5 * 1024 * 1024 + 1));

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is too big to be an Ember backup.');
    expect(backup.parseBackup).not.toHaveBeenCalled();
  });

  it('records the backup only after the file was saved, not when the picker is cancelled', async () => {
    vi.mocked(saveExport).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Export backup' }));
    expect(saveExport).toHaveBeenCalledOnce();
    expect(backup.markBackedUp).not.toHaveBeenCalled();
    expect(screen.queryByText('Backup saved.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Export backup' }));

    expect(await screen.findByText('Backup saved.')).toBeInTheDocument();
    expect(backup.markBackedUp).toHaveBeenCalledOnce();
  });
});
