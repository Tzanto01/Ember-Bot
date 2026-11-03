import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { localMode } from '@/lib/services';
import { renderPage } from '@/test-utils';
import LocalStartPage from './local-start';

vi.mock('@/lib/services', async () => {
  const { Store } = await import('@/lib/store');
  return { localMode: { mode: new Store('account'), evicted: new Store(false), start: vi.fn() } };
});

describe('LocalStartPage', () => {
  it('warns that the data stays on this device, then starts no-account mode before going to Today', async () => {
    let finish = () => {};
    vi.mocked(localMode.start).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const router = renderPage('/local', LocalStartPage, '/local');
    expect(screen.getByText(/Browsers can delete site data/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Start without an account' }));
    expect(localMode.start).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/local');
    finish();

    expect(await screen.findByRole('heading', { name: '/today' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
  });
});
