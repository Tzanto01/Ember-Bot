import { act, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReduceMotion } from '@/components/moment/use-reduce-motion';
import { TodaysEmber } from '@/components/today/todays-ember';
import { WhatsNewCard } from '@/components/today/whats-new-card';
import { applyCalm } from '@/lib/theme';
import { renderPage } from '@/test-utils';

describe('calm mode', () => {
  afterEach(() => {
    applyCalm(false);
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hides every data-calm-hide element and stops all motion in the stylesheet', () => {
    const css = readFileSync('src/calm.css', 'utf8');
    expect(css).toMatch(/:root\[data-calm\] \[data-calm-hide\]\s*\{\s*display:\s*none\s*!important/);
    expect(css).toMatch(/:root\[data-calm\] \*,[\s\S]*?animation[\s\S]*?\}/);
  });

  it('marks the ember summary as something calm mode hides', () => {
    const { container } = render(<TodaysEmber count={2} lowDay={false} stepping={false} />);
    expect(container.firstElementChild).toHaveAttribute('data-calm-hide');
  });

  it("marks Today's What's new card as something calm mode hides", async () => {
    localStorage.setItem('ember.seenReleaseNotes', '0.9.0-beta.5');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([{ version: '0.9.0-beta.6', date: '2026-11-14', notes: { en: ['New.'] } }]),
      ),
    );
    renderPage('/today', WhatsNewCard, '/today');

    const heading = await screen.findByText('Ember 0.9.0-beta.6 is here');
    expect(heading.closest('[data-calm-hide]')).not.toBeNull();
  });

  it('turns useReduceMotion on with calm mode and off again with it, without a system preference', () => {
    const { result } = renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);

    act(() => applyCalm(true));
    expect(document.documentElement).toHaveAttribute('data-calm');
    expect(result.current).toBe(true);

    act(() => applyCalm(false));
    expect(document.documentElement).not.toHaveAttribute('data-calm');
    expect(result.current).toBe(false);
  });
});
