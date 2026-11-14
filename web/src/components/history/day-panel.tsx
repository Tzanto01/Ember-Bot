import { Minus, Moon, Plus } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  /** The habit's check-ins a day; above 1 the panel adds a stepper that calls `onSetCount`. */
  timesPerDay?: number;
  onSetCount?: (count: number) => void;
  onToggleLowDay: () => void;
  onClose: () => void;
  className?: string;
}

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/**
 * `section#day-panel` for the open History day: long date heading (focused on open), state text, a check-in
 * stepper for multi-count habits, Done / Not done / Clear, the low-day switch, busy and error states, and Close.
 * Escape closes it.
 */
export function DayPanel({
  day,
  busy,
  problem,
  onEdit,
  timesPerDay = 1,
  onSetCount,
  onToggleLowDay,
  onClose,
  className,
}: DayPanelProps) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const text = dayLabel(day, timesPerDay);
  const count = Math.min(day.count, timesPerDay);
  const step = (next: number) => {
    if (!busy && next >= 0 && next <= timesPerDay) onSetCount?.(next);
  };

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
        <h3 id="day-panel-heading" ref={heading} tabIndex={-1} className="text-[1.125rem] focus:outline-none">
          {formatDate(day.date, longDate)}
        </h3>
        <p className="text-muted-foreground">{text.charAt(0).toUpperCase() + text.slice(1)}</p>
      </div>
      {timesPerDay > 1 && onSetCount && (
        <div className="flex flex-col gap-2">
          <p id="day-count-label" className="font-medium">
            {t('day.checkIns')}
          </p>
          <div role="group" aria-labelledby="day-count-label" className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('day.fewer')}
              aria-disabled={busy || count <= 0 || undefined}
              onClick={() => step(count - 1)}
            >
              <Minus aria-hidden />
            </Button>
            <span className="min-w-[4.5rem] text-center text-[1.125rem] font-semibold tabular-nums">
              {t('day.count', { count, total: timesPerDay })}
            </span>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('day.more')}
              aria-disabled={busy || count >= timesPerDay || undefined}
              onClick={() => step(count + 1)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button aria-disabled={busy || undefined} onClick={() => onEdit('done')}>
            {t('day.done')}
          </Button>
          <Button
            variant="secondary"
            aria-disabled={busy || undefined}
            aria-describedby="day-panel-choices"
            onClick={() => onEdit('notdone')}
          >
            {t('day.notDone')}
          </Button>
          <Button
            variant="secondary"
            aria-disabled={busy || undefined}
            aria-describedby="day-panel-choices"
            onClick={() => onEdit('clear')}
          >
            {t('day.clear')}
          </Button>
        </div>
        <p id="day-panel-choices" className="text-[0.875rem] text-muted-foreground">
          {t('day.choices')}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" className="-ms-2" aria-disabled={busy || undefined} onClick={onToggleLowDay}>
          <Moon aria-hidden />
          {day.lowDay ? t('day.lowDayOff') : t('day.lowDayOn')}
        </Button>
        <p className="text-[0.875rem] text-muted-foreground">{t('day.lowDayAll')}</p>
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-[0.875rem] text-muted-foreground">
          <Spinner />
          {t('day.saving')}
        </p>
      )}
      {problem && <Notice tone="notice">{problem}</Notice>}
      <div>
        <Button variant="ghost" className="-ms-2" onClick={onClose}>
          {t('day.close')}
        </Button>
      </div>
    </motion.section>
  );
}
