import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      t('routine.habits.moved', { name: habit?.name ?? t('routine.habits.habit'), n: target + 1, total: value.length }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={announcement} />
      <div className="flex flex-col gap-2">
        <p id={`${id}-in`} className="font-medium">
          {t('routine.habits.in')}
        </p>
        {members.length === 0 ? (
          <p className="text-[0.875rem] text-muted-foreground">{t('routine.habits.none')}</p>
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
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] max-[379px]:basis-[calc(100%-2.5rem)]">{habit.name}</span>
                <Button
                  id={`${id}-up-${habit.id}`}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-[379px]:ms-auto"
                  aria-label={t('routine.habits.up', { name: habit.name })}
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
                  aria-label={t('routine.habits.down', { name: habit.name })}
                  aria-disabled={index === members.length - 1 || undefined}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('routine.habits.remove', { name: habit.name })}
                  onClick={() =>
                    apply(
                      value.filter((hid) => hid !== habit.id),
                      `${id}-add-${habit.id}`,
                      t('routine.habits.removed', { name: habit.name }),
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {error && <p className="text-[0.875rem] text-destructive">{error}</p>}
      </div>

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <p id={`${id}-add`} className="font-medium">
            {t('routine.habits.add')}
          </p>
          <ul aria-labelledby={`${id}-add`} className="flex flex-col gap-2">
            {others.map((habit) => {
              const from = otherRoutine(habit);
              return (
                <li key={habit.id} className="flex min-h-[56px] items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="[overflow-wrap:anywhere]">{habit.name}</span>
                    {from && (
                      <span className="text-[0.875rem] text-muted-foreground">
                        {t('routine.habits.from', { routine: routineTitle(from.name) })}
                      </span>
                    )}
                  </span>
                  <Button
                    id={`${id}-add-${habit.id}`}
                    type="button"
                    variant="secondary"
                    aria-label={t('routine.habits.addOne', { name: habit.name })}
                    onClick={() =>
                      apply(
                        [...value, habit.id],
                        `${id}-up-${habit.id}`,
                        t('routine.habits.added', { name: habit.name, n: value.length + 1 }),
                      )
                    }
                  >
                    <Plus aria-hidden />
                    {t('routine.habits.addButton')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {habits.length === 0 && (
        <p className="text-[0.875rem] text-muted-foreground">{t('routine.habits.empty')}</p>
      )}
    </div>
  );
}
