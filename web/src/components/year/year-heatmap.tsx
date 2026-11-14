import { ArrowLeft } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { currentLanguage, t } from '@/lib/i18n';
import { addDays, formatDate, weekdayLabels } from '@/lib/local-date';
import type { LocalDateString } from '@/lib/models';
import { cn } from '@/lib/utils';
import { type YearDay, type YearTone, yearWeeks } from './year-data';

const toneClass: Record<YearTone, string> = {
  0: 'border-[1.5px] border-empty',
  1: 'bg-heat-1',
  2: 'bg-heat-2',
  3: 'bg-done',
  lowday: 'bg-lowday shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--lowday-foreground)_60%,transparent)]',
  paused: 'border-[1.5px] border-dashed border-paused',
  offday: 'border-[1.5px] border-dotted border-empty',
};

const cellSize = 'size-[20px] rounded-[4px] pointer-coarse:size-[28px] pointer-coarse:rounded-[6px]';
const longDates = new Map<string, Intl.DateTimeFormat>();

function longDate(): Intl.DateTimeFormat {
  const language = currentLanguage();
  let format = longDates.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    longDates.set(language, format);
  }
  return format;
}

/** "{long date}: {words}, mood {label}", the cell's accessible name. */
export function yearDayName(date: LocalDateString, day: YearDay | undefined, showMoods: boolean): string {
  const values = {
    date: longDate().format(new Date(`${date}T00:00:00Z`)),
    words: day?.words ?? t('year.nothingRecorded'),
  };
  return showMoods && day?.mood
    ? t('year.cellNameMood', { ...values, mood: day.mood.label })
    : t('year.cellName', values);
}

/** A legend or grid swatch for `tone`, optionally with the mood marker. */
export function YearSwatch({ tone, mood = false, className }: { tone: YearTone; mood?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-block shrink-0 forced-color-adjust-none',
        cellSize,
        toneClass[tone],
        mood &&
          'after:absolute after:-right-[2px] after:-top-[2px] after:size-[5px] after:rounded-full after:bg-muted-foreground after:ring-2 after:ring-card pointer-coarse:after:size-[8px]',
        className,
      )}
    />
  );
}

export interface YearHeatmapProps {
  /** Monday of the first week column. */
  start: LocalDateString;
  today: LocalDateString;
  /** Earliest day that can be picked (the habit's start, or `start`). */
  first: LocalDateString;
  days: ReadonlyMap<LocalDateString, YearDay>;
  showMoods: boolean;
  selected: LocalDateString | null;
  /** The day that holds the tab stop. */
  cursor: LocalDateString;
  onCursor: (date: LocalDateString) => void;
  onSelect: (date: LocalDateString) => void;
  /** Id of the detail panel the cells control. */
  detailId: string;
}

const keySteps: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };

/**
 * The year as a table: weekday rows (Monday first), one column per week, month labels on top. Every day is a
 * button named with its date and wording; one tab stop, arrow keys move by day and week, Home and End jump to
 * the first and latest day; Escape on the open day closes it. Scrolls inside its own box when the year doesn't
 * fit, latest week in view first, with a line saying earlier months are to the left.
 */
export function YearHeatmap({
  start,
  today,
  first,
  days,
  showMoods,
  selected,
  cursor,
  onCursor,
  onSelect,
  detailId,
}: YearHeatmapProps) {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const weeks = Array.from({ length: yearWeeks }, (_, w) => addDays(start, w * 7));
  const rowNames = weekdayLabels(i18n.language, 'long');
  const rowShort = weekdayLabels(i18n.language, 'short');
  const monthStarts = weeks.map(
    (monday) => Array.from({ length: 7 }, (_, d) => addDays(monday, d)).find((d) => d.endsWith('-01')) ?? null,
  );

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollLeft = box.scrollWidth;
    const measure = () => setScrollable(box.scrollWidth > box.clientWidth + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [start]);

  function move(event: KeyboardEvent, date: LocalDateString) {
    let next: LocalDateString | null = null;
    if (event.key === 'Escape' && selected === date) {
      event.preventDefault();
      onSelect(date);
      return;
    }
    if (event.key in keySteps) next = addDays(date, keySteps[event.key]);
    else if (event.key === 'Home') next = first;
    else if (event.key === 'End') next = today;
    if (!next) return;
    event.preventDefault();
    if (next < first) next = first;
    if (next > today) next = today;
    flushSync(() => onCursor(next));
    tableRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
  }

  return (
    <>
      {scrollable && (
        <p className="flex items-center gap-1.5 text-[0.875rem] text-muted-foreground">
          <ArrowLeft aria-hidden className="size-[16px] shrink-0" />
          {t('year.scrollHint')}
        </p>
      )}
      <div ref={scrollRef} className="-mx-1 overflow-x-auto px-1 pb-2">
        <table
          ref={tableRef}
          aria-label={t('year.tableLabel')}
          className="[border-collapse:separate] [border-spacing:4px] pointer-coarse:[border-spacing:0]"
        >
          <thead>
            <tr>
              <td className="sticky left-0 z-[2] bg-card shadow-[-8px_0_0_var(--card)]" />
              {weeks.map((monday, w) => {
                const label = w === 0 && !monthStarts[1] ? monday : w < yearWeeks - 1 ? monthStarts[w] : null;
                if (!label) return <td key={monday} className="h-[20px] p-0" />;
                return (
                  <th key={monday} scope="col" className="relative h-[20px] p-0 text-left align-bottom">
                    <span className="absolute bottom-0 left-0 whitespace-nowrap text-[13px] font-normal text-muted-foreground">
                      {formatDate(label, { month: 'short' })}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowNames.map((name, row) => (
              <tr key={name}>
                <th scope="row" className="sticky left-0 z-[2] bg-card shadow-[-8px_0_0_var(--card)] p-0 pr-1 text-left text-[13px] font-normal text-muted-foreground">
                  <span aria-hidden="true" className={row % 2 === 0 ? undefined : 'invisible'}>
                    {rowShort[row]}
                  </span>
                  <span className="sr-only">{name}</span>
                </th>
                {weeks.map((monday) => {
                  const date = addDays(monday, row);
                  if (date > today || date < first) {
                    return (
                      <td key={date} className="p-0">
                        <span className={cn('block', cellSize, 'pointer-coarse:m-[2px]')} />
                      </td>
                    );
                  }
                  const day = days.get(date);
                  return (
                    <td key={date} className="p-0">
                      <button
                        type="button"
                        data-date={date}
                        tabIndex={date === cursor ? 0 : -1}
                        aria-label={yearDayName(date, day, showMoods)}
                        aria-expanded={selected === date}
                        aria-controls={selected === date ? detailId : undefined}
                        onClick={() => {
                          onCursor(date);
                          onSelect(date);
                        }}
                        onKeyDown={(e) => move(e, date)}
                        className={cn(
                          'flex rounded-[4px] focus-visible:relative focus-visible:z-[1] focus-visible:outline-offset-1 pointer-coarse:rounded-[8px] pointer-coarse:p-[2px]',
                          selected === date && 'outline-2 outline-offset-1 outline-foreground pointer-coarse:-outline-offset-1',
                        )}
                      >
                        <YearSwatch
                          tone={day?.tone ?? 0}
                          mood={showMoods && !!day?.mood}
                          className={date === today ? 'ring-2 ring-pending ring-offset-1 ring-offset-card' : undefined}
                        />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Swatches for the grid's fills; the single-habit states and the mood marker only when they apply. */
export function YearLegend({ habit, showMoods }: { habit: boolean; showMoods: boolean }) {
  const { t } = useTranslation();
  const item = 'flex items-center gap-2';
  return (
    <ul aria-label={t('calendar.legendLabel')} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.875rem] text-muted-foreground">
      <li className={item}>
        <span>{t('year.legend.less')}</span>
        {([0, 1, 2, 3] as const).map((tone) => (
          <YearSwatch key={tone} tone={tone} />
        ))}
        <span>{t('year.legend.more')}</span>
      </li>
      {habit && (
        <>
          <li className={item}>
            <YearSwatch tone="lowday" />
            {t('year.legend.lowday')}
          </li>
          <li className={item}>
            <YearSwatch tone="paused" />
            {t('year.legend.paused')}
          </li>
          <li className={item}>
            <YearSwatch tone="offday" />
            {t('year.legend.offday')}
          </li>
        </>
      )}
      {showMoods && (
        <li className={item}>
          <YearSwatch tone={0} mood />
          {t('year.legend.mood')}
        </li>
      )}
    </ul>
  );
}
