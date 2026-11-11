import { Check } from 'lucide-react';
import type { AnimationEvent } from 'react';
import { Spinner } from '@/components/spinner';
import { cn } from '@/lib/utils';
import type { RewardKeyword } from './reward';

/** The id of a habit's check button on Today, so focus can return to it. */
export const checkButtonId = (habitId: number) => `check-${habitId}`;

export interface CheckButtonProps {
  id?: string;
  habitName: string;
  pressed: boolean;
  busy: boolean;
  /** The reward playing after the user's own tap; null otherwise. */
  reward: RewardKeyword | null;
  onToggle: () => void;
  /** The reward animation finished; drop the transient class. */
  onRewardEnd: () => void;
  /** For a multi-count habit (`target` above 1): today's check-ins, shown as "2/3" until done. */
  count?: number;
  target?: number;
}

/**
 * Today's 56 px check-in toggle (`aria-pressed`, "Check in {habit} for today"). Unpressed: open `--pending` edge,
 * no tick. Pressed: `--done` fill with a check. Busy: `aria-disabled`, and a spinner once no reward is playing.
 * Multi-count: the name adds "(2/3)", the face shows "2/3" with a `--done` edge once started.
 */
export function CheckButton({
  id,
  habitName,
  pressed,
  busy,
  reward,
  onToggle,
  onRewardEnd,
  count = 0,
  target = 1,
}: CheckButtonProps) {
  const ended = (event: AnimationEvent<HTMLButtonElement>) => {
    if (event.target === event.currentTarget) onRewardEnd();
  };
  const multi = target > 1;
  const started = multi && !pressed && count > 0;
  return (
    <button
      id={id}
      type="button"
      aria-pressed={pressed}
      aria-label={`Check in ${habitName} for today${multi ? ` (${Math.min(count, target)}/${target})` : ''}`}
      aria-disabled={busy || undefined}
      onClick={onToggle}
      onAnimationEnd={ended}
      className={cn(
        'relative grid size-[56px] shrink-0 cursor-pointer place-items-center rounded-cell border-2 transition-[background-color,border-color,color,transform] duration-[var(--ember-dur)] ease-ember active:scale-[0.98] aria-disabled:cursor-progress',
        pressed
          ? 'border-done bg-done text-done-foreground'
          : started
            ? 'border-done bg-[color-mix(in_oklch,var(--done)_14%,var(--card))] text-foreground'
            : 'border-pending bg-card text-foreground',
        reward && `ember-reward-${reward}`,
      )}
    >
      {busy && !reward ? (
        <Spinner className="size-[22px]" />
      ) : (
        <>
          {pressed && <Check aria-hidden className="size-[26px]" strokeWidth={2.5} />}
          {multi && !pressed && (
            <span aria-hidden="true" className={cn('text-[16px] font-semibold tabular-nums', !started && 'text-muted-foreground')}>
              {count}/{target}
            </span>
          )}
        </>
      )}
    </button>
  );
}
