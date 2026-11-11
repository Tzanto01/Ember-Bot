import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import type { Habit, Routine } from '@/lib/models';
import { routineTitle } from './routine-title';

export interface RoutineHabitsProps {
  /** The member habit ids, in routine order. */
  value: number[];
  onChange: (ids: number[]) => void;
  habits: Habit[];
  /** Every routine, to say which other routine a habit would move from. */
  routines: Routine[];
  /** The routine being edited (null while creating). */
  routineId: number | null;
  /** A server message for `habitIds`. */
  error?: string | null;
}

/**
 * The routine's habits as an ordered list with Move up, Move down and Remove buttons (no drag), then the other
 * habits with Add. Focus stays on the pressed control's habit and each change is announced.
 */
export function RoutineHabits({ value, onChange, habits, routines, routineId, error }: RoutineHabitsProps) {
  const id = useId();
  const [announcement, setAnnouncement] = useState('');
  const byId = new Map(habits.map((h) => [h.id, h]));
  const members = value.flatMap((hid) => byId.get(hid) ?? []);
  const others = habits.filter((h) => !value.includes(h.id));
  const otherRoutine = (habit: Habit) =>
    routines.find((r) => r.id !== routineId && r.habitIds.includes(habit.id)) ?? null;

  function apply(next: number[], focusId: string, message: string): void {
    flushSync(() => {
      onChange(next);
      setAnnouncement(message);
    });
    document.getElementById(focusId)?.focus();
  }

  function move(index: number, step: -1 | 1): void {
    const target = index + step;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    const habit = byId.get(value[index]);
    apply(
      next,
      `${id}-${step < 0 ? 'up' : 'down'}-${value[index]}`,
      `${habit?.name ?? 'Habit'} moved to ${target + 1} of ${value.length}.`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={announcement} />
      <div className="flex flex-col gap-2">
        <p id={`${id}-in`} className="font-medium">
          Habits in this routine
        </p>
        {members.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">None yet. Add the habits you do together below.</p>
        ) : (
          <ol aria-labelledby={`${id}-in`} className="flex flex-col gap-2">
            {members.map((habit, index) => (
              <li
                key={habit.id}
                className="flex min-h-[56px] items-center gap-1 rounded-md max-[379px]:flex-wrap border-[length:max(1px,var(--border-width))] border-input bg-card py-1 ps-3 pe-1"
              >
                <span aria-hidden="true" className="w-6 shrink-0 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words max-[379px]:basis-[calc(100%-1.75rem)]">{habit.name}</span>
                <Button
                  id={`${id}-up-${habit.id}`}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-[379px]:ms-auto"
                  aria-label={`Move ${habit.name} up`}
                  aria-disabled={index === 0 || undefined}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  id={`${id}-down-${habit.id}`}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${habit.name} down`}
                  aria-disabled={index === members.length - 1 || undefined}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${habit.name} from this routine`}
                  onClick={() =>
                    apply(
                      value.filter((hid) => hid !== habit.id),
                      `${id}-add-${habit.id}`,
                      `${habit.name} removed from this routine.`,
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {error && <p className="text-[14px] text-destructive">{error}</p>}
      </div>

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <p id={`${id}-add`} className="font-medium">
            Add habits
          </p>
          <ul aria-labelledby={`${id}-add`} className="flex flex-col gap-2">
            {others.map((habit) => {
              const from = otherRoutine(habit);
              return (
                <li key={habit.id} className="flex min-h-[56px] items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words">{habit.name}</span>
                    {from && (
                      <span className="text-[14px] text-muted-foreground">
                        In your {routineTitle(from.name)}. Adding it moves it here.
                      </span>
                    )}
                  </span>
                  <Button
                    id={`${id}-add-${habit.id}`}
                    type="button"
                    variant="secondary"
                    aria-label={`Add ${habit.name}`}
                    onClick={() =>
                      apply([...value, habit.id], `${id}-up-${habit.id}`, `${habit.name} added, ${value.length + 1} of ${value.length + 1}.`)
                    }
                  >
                    <Plus aria-hidden />
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {habits.length === 0 && (
        <p className="text-[14px] text-muted-foreground">Once you have habits, you can group them here.</p>
      )}
    </div>
  );
}
