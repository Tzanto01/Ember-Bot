import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivalWindowMs } from '@/lib/arrival';
import { CenteredShell } from './centered-shell';

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      {
        Component: CenteredShell,
        children: ['about', 'download', 'moment', 'legal/privacy'].map((p) => ({
          path: p,
          element: <h1>{p}</h1>,
        })),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('CenteredShell arrival', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arrives once per navigation and settles after the window, also on a quick return', async () => {
    const router = renderShell('/about');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('data-arrive', 'card');

    act(() => vi.advanceTimersByTime(arrivalWindowMs));
    expect(main).not.toHaveAttribute('data-arrive');

    await act(() => router.navigate('/download'));
    expect(main).toHaveAttribute('data-arrive', 'card');
    await act(() => router.navigate('/about'));
    expect(main).toHaveAttribute('data-arrive', 'card');
    act(() => vi.advanceTimersByTime(arrivalWindowMs));
    expect(main).not.toHaveAttribute('data-arrive');
  });

  it('keeps legal pages still, without arrival or glow', () => {
    renderShell('/legal/privacy');
    expect(screen.getByRole('main')).not.toHaveAttribute('data-arrive');
    expect(screen.getByRole('main').closest('[data-motion="off"]')).not.toBeNull();
    expect(document.querySelector('.ember-glow')).toBeNull();
  });

  it('keeps the moment flow without arrival or glow and its header flame still', () => {
    renderShell('/moment');
    expect(screen.getByRole('main')).not.toHaveAttribute('data-arrive');
    expect(document.querySelector('header')).toHaveAttribute('data-motion', 'off');
    expect(document.querySelector('.ember-glow')).toBeNull();
  });

  it('puts the moment flow by a campfire that calm mode hides', () => {
    renderShell('/moment');
    expect(document.querySelector('.ember-scene [data-calm-hide] svg')).not.toBeNull();
  });
});
