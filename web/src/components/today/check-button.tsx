import { Check } from 'lucide-react';
import type { AnimationEvent } from 'react';
import { Spinner } from '@/components/spinner';
import { cn } from '@/lib/utils';
import type { RewardKeyword } from './reward';

export interface CheckButtonProps {
  habitName: string;
  pressed: boolean;
  busy: boolean;
  /** The reward playing after the user's own tap; null otherwise. */
  reward: RewardKeyword | null;
  onToggle: () => void;
  /** The reward animation finished; drop the transient class. */
  onRewardEnd: () => void;
}

/**
 * Today's 56 px check-in toggle (`aria-pressed`, "Check in {habit} for today"). Unpressed: open `--pending` edge,
 * no tick. Pressed: `--done` fill with a check. Busy: `aria-disabled`, and a spinner once no reward is playing.
 */
export function CheckButton({ habitName, pressed, busy, reward, onToggle, onRewardEnd }: CheckButtonProps) {
  const ended = (event: AnimationEvent<HTMLButtonElement>) => {
    if (event.target === event.currentTarget) onRewardEnd();
  };
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`Check in ${habitName} for today`}
      aria-disabled={busy || undefined}
      onClick={onToggle}
      onAnimationEnd={ended}
      className={cn(
        'relative grid size-[56px] shrink-0 cursor-pointer place-items-center rounded-cell border-2 transition-[background-color,border-color,color,transform] duration-[var(--ember-dur)] ease-ember active:scale-[0.98] aria-disabled:cursor-progress',
        pressed ? 'border-done bg-done text-done-foreground' : 'border-pending bg-card text-foreground',
        reward && `ember-reward-${reward}`,
      )}
    >
      {busy && !reward ? (
        <Spinner className="size-[22px]" />
      ) : (
        pressed && <Check aria-hidden className="size-[26px]" strokeWidth={2.5} />
      )}
    </button>
  );
}
