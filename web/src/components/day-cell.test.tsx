import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDate } from '@/lib/local-date';
import type { DayState } from '@/lib/models';
import { DayCell, joinsRun } from './day-cell';

const longDate = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });

describe('DayCell', () => {
  it.each<[DayState, string]>([
    ['done', 'done'],
    ['notdone', 'not checked in'],
    ['pending', 'still open'],
    ['lowday', 'low day, resting'],
    ['paused', 'paused'],
  ])('names an editable %s day "{long date}, %s"', (state, words) => {
    render(<DayCell state={state} date="2026-10-28" onSelect={() => {}} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(`${longDate('2026-10-28')}, ${words}`);
    expect(button.getAttribute('aria-label')).not.toMatch(/missed/i);
  });

  it('prefixes "today, " and marks the current date', () => {
    render(<DayCell state="done" date="2026-11-01" isToday onSelect={() => {}} />);

    const button = screen.getByRole('button', { name: `${longDate('2026-11-01')}, today, done` });
    expect(button).toHaveAttribute('aria-current', 'date');
  });

  it('renders an editable day as button#day-{date} with data-state and a string aria-expanded', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<DayCell state="notdone" date="2026-10-30" onSelect={onSelect} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('id', 'day-2026-10-30');
    expect(button).toHaveAttribute('data-state', 'notdone');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');

    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(<DayCell state="notdone" date="2026-10-30" onSelect={onSelect} expanded />);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'day-panel');
  });

  it('renders a non-editable day as a named span without a button or an id', () => {
    const { container } = render(<DayCell state="beforestart" date="2026-10-02" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[id]')).toBeNull();
    expect(screen.getByText(`${longDate('2026-10-02')}, before this habit started`)).toBeInTheDocument();
  });

  it('names a day that has not happened yet "not yet"', () => {
    render(<DayCell state={null} date="2026-11-05" />);

    expect(screen.getByText(`${longDate('2026-11-05')}, not yet`)).toBeInTheDocument();
  });

  it.each(['swatch', 'pip', 'slot'] as const)('renders the static %s variant hidden, without a button or an id', (size) => {
    const { container } = render(<DayCell state="done" size={size} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[id]')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('joinsRun', () => {
  it('carries a run through low days, and breaks it at paused, open or empty days', () => {
    expect(joinsRun('done', 'done')).toBe(true);
    expect(joinsRun('done', 'lowday')).toBe(true);
    expect(joinsRun('lowday', 'done')).toBe(true);
    expect(joinsRun('done', 'paused')).toBe(false);
    expect(joinsRun('done', 'notdone')).toBe(false);
    expect(joinsRun('done', 'pending')).toBe(false);
    expect(joinsRun('done', undefined)).toBe(false);
  });

  it('draws the connector out of a low day too', () => {
    const { container } = render(<DayCell state="lowday" size="swatch" runToNext />);
    expect(container.firstElementChild?.className).toContain('after:bg-done');
  });
});
