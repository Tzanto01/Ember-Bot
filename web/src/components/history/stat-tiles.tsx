import { useTranslation } from 'react-i18next';
import type { KeptDays } from '@/components/history/kept-days';
import { cardVariants } from '@/components/ui/card';
import type { Habit } from '@/lib/models';
import { cn } from '@/lib/utils';

export interface StatTilesProps {
  habit: Habit;
  /** Month name of the shown month, for example "October". */
  monthName: string;
  /** `done` days in the shown month; null while the month's days aren't loaded; the tile is left out then and at 0. */
  doneInMonth: number | null;
  /** Low days in the shown month. */
  lowDaysInMonth: number;
  /** Kept days of the last 7 days (daily and weekdays habits); null while not loaded. */
  last7Days?: KeptDays | null;
  /** Kept days of the last 30 days (daily and weekdays habits); null while not loaded. */
  last30Days?: KeptDays | null;
  /** The account's `showStreaks`: false leaves the Current streak and Best tiles out. */
  showStreaks: boolean;
}

interface Tile {
  label: string;
  value: string;
}

/** "At a glance" for the History habit: up to five compact tiles that lead with what is there, never with gaps. */
export function StatTiles({ habit, monthName, doneInMonth, lowDaysInMonth, last7Days, last30Days, showStreaks }: StatTilesProps) {
  const { t } = useTranslation();
  const { streak, bestStreak, last7, week } = habit.stats;
  const tiles: Tile[] = [];
  if (week) {
    tiles.push({
      label: t('stats.thisWeek'),
      value: week.done > 0 ? t('stats.weekProgress', { done: week.done, target: week.target }) : t('stats.perWeek', { target: week.target }),
    });
    if (last7 > 0) tiles.push({ label: t('stats.lastDays', { count: 7 }), value: t('stats.done', { count: last7 }) });
  } else {
    if (showStreaks) {
      tiles.push({ label: t('stats.currentStreak'), value: streak ? t('stats.days', { count: streak }) : t('stats.freshStart') });
    }
    if (showStreaks && bestStreak) tiles.push({ label: t('stats.best'), value: t('stats.days', { count: bestStreak }) });
    for (const [window, days] of [[7, last7Days], [30, last30Days]] as const) {
      if (!days?.kept || (window === 30 && days.span <= 7)) continue;
      tiles.push({
        label: days.span === window ? t('stats.lastDays', { count: window }) : t('stats.sinceStart'),
        value: t('stats.kept', { kept: days.kept, span: days.span }),
      });
    }
  }
  if (doneInMonth) {
    tiles.push({
      label: t('stats.inMonth', { month: monthName }),
      value:
        lowDaysInMonth > 0
          ? t('stats.monthValue', {
              done: t('stats.done', { count: doneInMonth }),
              lowDays: t('stats.lowDays', { count: lowDaysInMonth }),
            })
          : t('stats.done', { count: doneInMonth }),
    });
  }

  if (tiles.length === 0) return null;

  return (
    <dl className={cn('grid gap-2', tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={cn(cardVariants({ variant: 'stat' }), 'min-w-0', tiles.length === 5 && i === 4 && 'col-span-2')}
        >
          <dt className="text-[14px]">{tile.label}</dt>
          <dd className="m-0 mt-auto font-semibold break-words">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
