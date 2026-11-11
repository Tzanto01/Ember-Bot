import { Flame, Leaf, Minus, Moon, Pause, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DayCell } from '@/components/day-cell';
import { habitCadence } from '@/components/habits/habit-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/local-date';
import type { Habit } from '@/lib/models';
import { cn } from '@/lib/utils';
import { CheckButton, checkButtonId } from './check-button';
import type { RewardKeyword } from './reward';
import { RollingNumber } from './rolling-number';

const shortDate: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };

export interface HabitRowProps {
  habit: Habit;
  busy: boolean;
  reward: RewardKeyword | null;
  onToggle: () => void;
  onRewardEnd: () => void;
  /** Takes one check-in off a multi-count habit; the row offers it once today has any. */
  onUndoOne?: () => void;
  /** `h3` when the row sits under a routine heading. */
  headingLevel?: 'h2' | 'h3';
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
  if (streak === 0) return <span>{habitCadence(habit)}</span>;
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

/**
 * One Today habit card: name, meta line, Edit icon link, and the CheckButton (or a static day slot when not
 * checkable). Multi-count habits show "2 of 3 today" and a "take one off" button once started; a rest day says so.
 */
export function HabitRow({
  habit,
  busy,
  reward,
  onToggle,
  onRewardEnd,
  onUndoOne,
  headingLevel: Heading = 'h2',
}: HabitRowProps) {
  const state = habit.today.state;
  const paused = state === 'paused' || habit.pausedToday;
  const notStarted = !paused && state === 'beforestart';
  const checkable = !paused && !notStarted;
  const done = checkable && state === 'done';
  const roll = reward !== null;
  const target = habit.timesPerDay;
  const count = Math.min(habit.today.count, target);
  const multi = checkable && target > 1;

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
  } else if (state === 'offday') {
    meta = (
      <span className="inline-flex items-start gap-1.5">
        <Leaf aria-hidden className="mt-[3px] size-[14px] shrink-0" />
        Rest day, nothing planned. Checking in is still welcome.
      </span>
    );
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
        {done ? (
          <span>Done today</span>
        ) : (
          multi && count > 0 && <span className="font-medium text-foreground">{count} of {target} today</span>
        )}
        <Progress habit={habit} roll={roll} />
      </>
    );
  }

  return (
    <li>
      <Card
        className={cn(
          'relative isolate grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-3 gap-y-0 py-3 md:py-3',
          done &&
            'bg-[color-mix(in_oklch,var(--done)_8%,var(--card))] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_3px_0_0_var(--done)]',
          reward === 'fill' && 'ember-row-fill',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <Heading className="text-[18px] break-words">{habit.name}</Heading>
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
              {meta}
            </p>
            <div className="flex shrink-0">
              {multi && count > 0 && onUndoOne && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label={`Take one check-in off ${habit.name}`}
                  aria-disabled={busy || undefined}
                  onClick={onUndoOne}
                >
                  <Minus aria-hidden />
                </Button>
              )}
              <Button asChild variant="ghost" size="icon" className="text-muted-foreground">
                <Link to={`/habits/${habit.id}/edit`} aria-label={`Edit ${habit.name}`}>
                  <Pencil aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </div>
        {checkable ? (
          <CheckButton
            id={checkButtonId(habit.id)}
            habitName={habit.name}
            pressed={done}
            busy={busy}
            reward={reward}
            onToggle={onToggle}
            onRewardEnd={onRewardEnd}
            count={count}
            target={multi ? target : 1}
          />
        ) : (
          <DayCell state={paused ? 'paused' : 'beforestart'} size="slot" />
        )}
      </Card>
    </li>
  );
}
