import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCalm } from '@/lib/theme';
import { BreathingPlayer } from './breathing-player';

function liveRegion(): HTMLElement {
  return document.querySelector<HTMLElement>('[aria-live="polite"]')!;
}

function circle(): HTMLElement {
  return screen.getByTestId('breath-circle');
}

function second(): void {
  act(() => vi.advanceTimersByTime(1000));
}

describe('BreathingPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for Start: no announcement and no progress before it', () => {
    render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(liveRegion()).toHaveTextContent('');
    expect(screen.queryByText(/Breathe in/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('announces once per phase change across a full inhale and exhale, never per second', () => {
    render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const heard = [liveRegion().textContent];
    for (let s = 0; s < 10; s++) {
      second();
      const text = liveRegion().textContent;
      if (text !== heard.at(-1)) heard.push(text);
    }
    expect(heard).toEqual([
      'Round 1 of 6. Breathe in, 4',
      'Breathe out, 6',
      'Round 2 of 6. Breathe in, 4',
    ]);
    expect(screen.getByText('Breathe in, 4')).toBeInTheDocument();
    expect(screen.getByText('Round 2 of 6')).toBeInTheDocument();
  });

  it('exposes its status as data-breath, which the ambient rhythm fades out against', () => {
    const { container } = render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={1} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('data-breath', 'ready');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(root).toHaveAttribute('data-breath', 'running');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(root).toHaveAttribute('data-breath', 'paused');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(root).toHaveAttribute('data-breath', 'done');
  });

  it('keeps its position while paused and resumes from there', () => {
    render(<BreathingPlayer inhale={4} hold={2} exhale={6} rounds={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    second();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(20_000));
    expect(
      screen.getByText('Breathe in, 3', { selector: 'p:not([aria-live])' }),
    ).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Paused');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(liveRegion()).toHaveTextContent('Breathe in, 3');
    second();
    second();
    second();
    expect(screen.getByText('Hold, 2', { selector: 'p:not([aria-live])' })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Hold, 2');
  });

  it('hides the circle from assistive tech and scales it only without reduced motion', () => {
    const { unmount } = render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    expect(circle().closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(circle().style.transform).toMatch(/scale/);
    unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    second();
    expect(circle().style.transform).toBe('');
    expect(circle().closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the circle still in calm mode', () => {
    applyCalm(true);
    try {
      render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      second();
      expect(circle().style.transform).toBe('');
      expect(screen.getByText('Breathe in, 3')).toBeInTheDocument();
    } finally {
      applyCalm(false);
    }
  });

  it('pauses without speaking while halted and resumes only when asked', () => {
    const { rerender } = render(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    second();
    rerender(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} halted />);
    act(() => vi.advanceTimersByTime(20_000));
    expect(liveRegion()).toHaveTextContent('Round 1 of 6. Breathe in, 4');
    expect(
      screen.getByText('Breathe in, 3', { selector: 'p:not([aria-live])' }),
    ).toBeInTheDocument();

    rerender(<BreathingPlayer inhale={4} hold={0} exhale={6} rounds={6} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(
      screen.getByText('Breathe in, 3', { selector: 'p:not([aria-live])' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(liveRegion()).toHaveTextContent('Breathe in, 3');
  });

  it('reports ready, running, paused and done so the page can move the emphasis', () => {
    const onStatusChange = vi.fn();
    render(
      <BreathingPlayer inhale={1} hold={0} exhale={1} rounds={1} onStatusChange={onStatusChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => vi.advanceTimersByTime(2_000));
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'ready',
      'running',
      'paused',
      'running',
      'done',
    ]);
  });
});
