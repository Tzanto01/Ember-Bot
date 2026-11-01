import { Check, Moon, Pause } from 'lucide-react';
import { dayStateWords } from '@/lib/calendar';
import { formatDate } from '@/lib/local-date';
import type { DayState, LocalDateString } from '@/lib/models';
import { cn } from '@/lib/utils';

/**
 * `cell`: History grid cell, square, fills its column between 44 and 56 px (the page sets the column width).
 * `slot`: 56 px, holds the CheckButton's place on Today. `swatch`: 24 px legend and sample-strip cell. `pip`: 6 px dot.
 */
export type DayCellSize = 'cell' | 'slot' | 'swatch' | 'pip';

export interface DayCellProps {
  /** The day's state; null for a day that hasn't happened yet ("not yet"). */
  state: DayState | null;
  /** With a date the cell shows its number and is named "{long date}, {state text}"; without one it is decorative. */
  date?: LocalDateString;
  isToday?: boolean;
  size?: DayCellSize;
  /** Makes the cell an editable `button#day-{date}` (requires `date`). */
  onSelect?: () => void;
  /** The day panel is open for this day (buttons only). */
  expanded?: boolean;
  /** Draws the run connector to the right-hand neighbour; pass true when this and that day are both `done`. */
  runToNext?: boolean;
  className?: string;
}

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

const sizeClass: Record<DayCellSize, string> = {
  cell: 'aspect-square w-full min-w-[44px] max-w-[56px]',
  slot: 'size-[56px]',
  swatch: 'size-[24px]',
  pip: 'size-[6px] rounded-full',
};

const stateClass: Record<DayState | 'future', string> = {
  done: 'bg-done text-done-foreground',
  notdone: 'border-[1.5px] border-empty text-foreground',
  pending: 'border-2 border-pending font-semibold text-foreground',
  lowday:
    'bg-lowday text-lowday-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--lowday-foreground)_35%,transparent)]',
  paused:
    'border-[1.5px] border-dashed border-paused bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--paused)_22%,transparent)_0_4px,transparent_4px_8px)] text-foreground',
  beforestart: 'text-beforestart',
  future: 'text-beforestart',
};

/** "{long date}, {state text}", with "today, " before the state text on today. Never "missed". */
export function dayCellName(date: LocalDateString, state: DayState | null, isToday = false): string {
  const words = state === null ? 'not yet' : dayStateWords[state];
  return `${formatDate(date, longDate)}, ${isToday ? 'today, ' : ''}${words}`;
}

/**
 * One day in any of the app's day views (History grid, legend, Today pips and slot, auth sample strip).
 * Every state has a non-colour cue: check (done), outline (not checked in), heavy edge plus dot (still open),
 * moon (low day), dashed hatch plus pause (paused), faint number (before start, not yet).
 * Editable days render `<button id="day-{date}" data-state aria-expanded>`; everything else is a span without an id.
 */
export function DayCell({
  state,
  date,
  isToday = false,
  size = 'cell',
  onSelect,
  expanded = false,
  runToNext = false,
  className,
}: DayCellProps) {
  const dataState = state ?? 'future';
  const large = size === 'cell' || size === 'slot';
  const classes = cn(
    'relative inline-flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-cell text-[14px] leading-none transition-colors',
    sizeClass[size],
    stateClass[dataState],
    runToNext &&
      state === 'done' &&
      'after:pointer-events-none after:absolute after:top-1/2 after:left-full after:h-[4px] after:w-[var(--day-gap,4px)] after:-translate-y-1/2 after:bg-done',
    className,
  );
  const content = size !== 'pip' && (
    <>
      {date && large && (
        <span aria-hidden="true" className={cn(isToday && 'underline decoration-2 underline-offset-[3px]')}>
          {Number(date.slice(8))}
        </span>
      )}
      {state === 'done' && <Check aria-hidden className="size-[14px]" />}
      {state === 'lowday' && <Moon aria-hidden className="size-[14px]" />}
      {state === 'paused' && size !== 'swatch' && (
        <Pause aria-hidden className={cn('size-[14px]', size === 'cell' && 'hidden md:block')} />
      )}
      {state === 'pending' && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-pending',
            large ? 'bottom-[5px]' : 'bottom-[2px]',
          )}
        />
      )}
    </>
  );

  if (onSelect && date) {
    return (
      <button
        type="button"
        id={`day-${date}`}
        data-state={dataState}
        aria-label={dayCellName(date, state, isToday)}
        aria-current={isToday ? 'date' : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? 'day-panel' : undefined}
        onClick={onSelect}
        className={cn(
          classes,
          'cursor-pointer aria-expanded:outline-3 aria-expanded:outline-offset-2 aria-expanded:outline-ring aria-expanded:outline-solid',
        )}
      >
        {content}
      </button>
    );
  }

  if (date) {
    return (
      <span data-state={dataState} aria-current={isToday ? 'date' : undefined} className={classes}>
        {content}
        <span className="sr-only">{dayCellName(date, state, isToday)}</span>
      </span>
    );
  }

  return (
    <span aria-hidden="true" data-state={dataState} className={classes}>
      {content}
    </span>
  );
}
