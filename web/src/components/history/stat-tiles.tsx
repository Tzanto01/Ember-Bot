import { cardVariants } from '@/components/ui/card';
import type { Habit } from '@/lib/models';
import { cn } from '@/lib/utils';

export interface StatTilesProps {
  habit: Habit;
  /** Month name of the shown month, for example "October". */
  monthName: string;
  /** `done` days in the shown month. */
  /** Null while the month's days aren't loaded; the tile is left out then and at 0. */
  doneInMonth: number | null;
  /** Low days in the shown month. */
  lowDaysInMonth: number;
}

interface Tile {
  label: string;
  value: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "At a glance" for the History habit: two or three compact tiles that lead with what is there, never with gaps. */
export function StatTiles({ habit, monthName, doneInMonth, lowDaysInMonth }: StatTilesProps) {
  const { streak, bestStreak, last7, week } = habit.stats;
  const tiles: Tile[] = [];
  if (week) {
    tiles.push({ label: 'This week', value: week.done > 0 ? `${week.done} of ${week.target}` : `${week.target} a week` });
    if (last7 > 0) tiles.push({ label: 'Last 7 days', value: `${last7} done` });
  } else {
    tiles.push({ label: 'Current streak', value: streak ? plural(streak, 'day') : 'Fresh start' });
    if (bestStreak) tiles.push({ label: 'Best', value: plural(bestStreak, 'day') });
  }
  if (doneInMonth) {
    tiles.push({
      label: `In ${monthName}`,
      value: `${doneInMonth} done${lowDaysInMonth > 0 ? ` · ${plural(lowDaysInMonth, 'low day')}` : ''}`,
    });
  }

  return (
    <dl className={cn('grid gap-2', tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {tiles.map((tile) => (
        <div key={tile.label} className={cn(cardVariants({ variant: 'stat' }), 'min-w-0')}>
          <dt className="text-[14px]">{tile.label}</dt>
          <dd className="m-0 mt-auto font-semibold break-words">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
