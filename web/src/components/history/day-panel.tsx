import { Moon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Spinner } from '@/components/spinner';
import { themeSeconds } from '@/components/today/reward';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { type CalendarDay, dayLabel } from '@/lib/calendar';
import { formatDate } from '@/lib/local-date';
import { cn } from '@/lib/utils';

/** What the day panel can do with the open day. */
export type DayAction = 'done' | 'notdone' | 'clear';

export interface DayPanelProps {
  day: CalendarDay;
  busy: boolean;
  problem: string | null;
  onEdit: (action: DayAction) => void;
  onToggleLowDay: () => void;
  onClose: () => void;
  className?: string;
}

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/**
 * `section#day-panel` for the open History day: long date heading (focused on open), state text, Done / Not done /
 * Clear, the low-day switch, busy and error states, and Close. Escape closes it.
 */
export function DayPanel({ day, busy, problem, onEdit, onToggleLowDay, onClose, className }: DayPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const text = dayLabel(day);

  useEffect(() => {
    heading.current?.focus();
  }, [day.date]);

  return (
    <motion.section
      id="day-panel"
      aria-labelledby="day-panel-heading"
      className={cn(cardVariants(), className)}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : themeSeconds('--ember-dur', 0.22) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 id="day-panel-heading" ref={heading} tabIndex={-1} className="text-[18px] focus:outline-none">
          {formatDate(day.date, longDate)}
        </h3>
        <p className="text-muted-foreground">{text.charAt(0).toUpperCase() + text.slice(1)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button aria-disabled={busy || undefined} onClick={() => onEdit('done')}>
          Done
        </Button>
        <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => onEdit('notdone')}>
          Not done
        </Button>
        <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => onEdit('clear')}>
          Clear
        </Button>
      </div>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" className="-ms-2" aria-disabled={busy || undefined} onClick={onToggleLowDay}>
          <Moon aria-hidden />
          {day.lowDay ? 'Clear low day' : 'Mark as a low day'}
        </Button>
        <p className="text-[14px] text-muted-foreground">Low days apply to all your habits.</p>
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <Spinner />
          Saving…
        </p>
      )}
      {problem && <Notice tone="notice">{problem}</Notice>}
      <div>
        <Button variant="ghost" className="-ms-2" onClick={onClose}>
          Close
        </Button>
      </div>
    </motion.section>
  );
}
