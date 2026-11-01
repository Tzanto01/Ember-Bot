import { Flame, Moon, Pause, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DayCell } from '@/components/day-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/local-date';
import type { Habit } from '@/lib/models';
import { cn } from '@/lib/utils';
import { CheckButton } from './check-button';
import type { RewardKeyword } from './reward';
import { RollingNumber } from './rolling-number';

const shortDate: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };

export interface HabitRowProps {
  habit: Habit;
  busy: boolean;
  reward: RewardKeyword | null;
  onToggle: () => void;
  onRewardEnd: () => void;
}

function Progress({ habit, roll }: { habit: Habit; roll: boolean }) {
  const week = habit.stats.week;
  if (week) {
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-flex gap-1">
          {Array.from({ length: week.target }, (_, i) => (
            <DayCell key={i} state={i < week.done ? 'done' : 'notdone'} size="pip" />
          ))}
        </span>
        {week.done > 0 ? (
          <span>
            <RollingNumber value={week.done} roll={roll} /> of {week.target} this week
          </span>
        ) : week.target === 1 ? (
          'Once a week'
        ) : (
          `${week.target} times a week`
        )}
      </span>
    );
  }
  const streak = habit.stats.streak ?? 0;
  if (streak === 0) return <span>Every day</span>;
  return (
    <Badge>
      <Flame aria-hidden />
      <span className="inline-flex">
        <RollingNumber value={streak} roll={roll} />
        -day streak
      </span>
    </Badge>
  );
}

/** One Today habit card: name, meta line, Edit icon link, and the CheckButton (or a static day slot when not checkable). */
export function HabitRow({ habit, busy, reward, onToggle, onRewardEnd }: HabitRowProps) {
  const state = habit.today.state;
  const paused = state === 'paused' || habit.pausedToday;
  const notStarted = !paused && state === 'beforestart';
  const checkable = !paused && !notStarted;
  const done = checkable && state === 'done';
  const roll = reward !== null;

  let meta: ReactNode;
  if (paused) {
    meta = (
      <span className="inline-flex items-start gap-1.5">
        <Pause aria-hidden className="mt-[3px] size-[14px] shrink-0" />
        {habit.pausedUntil
          ? `Paused until ${formatDate(habit.pausedUntil, shortDate)}. You can resume it any time under Edit.`
          : 'Paused. You can resume it any time under Edit.'}
      </span>
    );
  } else if (notStarted) {
    meta = <span>Starts {formatDate(habit.startDate, shortDate)}.</span>;
  } else if (state === 'lowday') {
    meta = (
      <span className="inline-flex items-start gap-1.5">
        <Moon aria-hidden className="mt-[3px] size-[14px] shrink-0" />
        Low day, resting. Checking in is still welcome.
      </span>
    );
  } else {
    meta = (
      <>
        {done && <span>Done today</span>}
        <Progress habit={habit} roll={roll} />
      </>
    );
  }

  return (
    <li>
      <Card
        className={cn(
          'relative isolate grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-3 gap-y-0 py-3 md:py-3',
          done && 'border-s-[3px] border-s-done bg-[color-mix(in_oklch,var(--done)_8%,var(--card))]',
          reward === 'fill' && 'ember-row-fill',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[18px] break-words">{habit.name}</h2>
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
              {meta}
            </p>
            <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
              <Link to={`/habits/${habit.id}/edit`} aria-label={`Edit ${habit.name}`}>
                <Pencil aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        {checkable ? (
          <CheckButton
            habitName={habit.name}
            pressed={done}
            busy={busy}
            reward={reward}
            onToggle={onToggle}
            onRewardEnd={onRewardEnd}
          />
        ) : (
          <DayCell state={paused ? 'paused' : 'beforestart'} size="slot" />
        )}
      </Card>
    </li>
  );
}
