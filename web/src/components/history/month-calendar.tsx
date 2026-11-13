import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DayCell, joinsRun } from '@/components/day-cell';
import type { RewardKeyword } from '@/components/today/reward';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import type { CalendarDay } from '@/lib/calendar';
import { weekdayLabels } from '@/lib/local-date';
import type { LocalDateString } from '@/lib/models';
import { cn } from '@/lib/utils';

export interface MonthCalendarProps {
  title: string;
  weeks: CalendarDay[][];
  loading: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  openDate: LocalDateString | null;
  onSelect: (date: LocalDateString) => void;
  /** A day just marked done from the day panel, with the theme's reward keyword. */
  reward: { date: LocalDateString; keyword: RewardKeyword } | null;
  onRewardEnd: () => void;
  /** Replaces the grid, for example the "These days didn't load" notice. */
  problem?: ReactNode;
  /** The habit's check-ins a day; partly done days show "2 of 3" when above 1. */
  timesPerDay?: number;
}

/**
 * The History month: pager with `h2#month-heading`, then a Monday-first table where only editable in-month days
 * are `button#day-{date}` cells; other in-month days are spans and other months' days stay empty.
 */
export function MonthCalendar({
  title,
  weeks,
  loading,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  openDate,
  onSelect,
  reward,
  onRewardEnd,
  problem,
  timesPerDay = 1,
}: MonthCalendarProps) {
  const { t, i18n } = useTranslation();
  const [shortDays, longDays] = useMemo(
    () => [weekdayLabels(i18n.language, 'short'), weekdayLabels(i18n.language, 'long')],
    [i18n.language],
  );
  return (
    <section aria-labelledby="month-heading" className={cn(cardVariants(), 'px-0 md:px-5')}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('calendar.previousMonth')}
          aria-disabled={!canPrevious || undefined}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <h2 id="month-heading" aria-live="polite" className="text-[22px]">
          {title}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t('calendar.nextMonth')} aria-disabled={!canNext || undefined} onClick={onNext}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      {problem ?? (
        <table
          aria-labelledby="month-heading"
          aria-busy={loading || undefined}
          className="isolate -mx-[4px] w-[calc(100%+8px)] max-w-[424px] table-fixed sm:mx-auto [border-collapse:separate] [border-spacing:4px] [--day-gap:4px] aria-busy:opacity-60 max-[359px]:mx-0 max-[359px]:w-full max-[359px]:[border-spacing:2px] max-[359px]:[--day-gap:2px] md:mx-auto md:w-auto"
        >
          <thead>
            <tr>
              {shortDays.map((short, i) => (
                <th key={short + i} scope="col" className="pb-1 text-[14px] font-medium text-muted-foreground md:w-[56px]">
                  <span aria-hidden="true">{short}</span>
                  <span className="sr-only">{longDays[i]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map((day, i) => {
                  const next = week[i + 1];
                  const keyword = reward?.date === day.date ? reward.keyword : null;
                  return (
                    <td
                      key={day.date}
                      className="p-0 text-center"
                      onAnimationEnd={keyword ? onRewardEnd : undefined}
                    >
                      {day.inMonth && (
                        <DayCell
                          state={day.state}
                          date={day.date}
                          isToday={day.isToday}
                          onSelect={day.editable ? () => onSelect(day.date) : undefined}
                          expanded={openDate === day.date}
                          runToNext={next?.inMonth === true && joinsRun(day.state, next.state)}
                          progress={{ count: day.count, target: timesPerDay }}
                          className={cn('align-middle', keyword && `ember-cell-reward-${keyword}`)}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
