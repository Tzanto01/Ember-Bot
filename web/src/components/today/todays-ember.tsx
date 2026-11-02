import { Moon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { themeSeconds } from './reward';

export interface TodaysEmberProps {
  /** Habits checked in today. */
  count: number;
  lowDay: boolean;
  /** True while a check-in reward plays; only then does the flame animate its step. */
  stepping: boolean;
  className?: string;
}

/**
 * The Today's ember summary: a flame that grows one step per check-in today (0.85 + 0.05 each, capped at 1.1,
 * glow rising with it) and a plain line of text: "{n} checked in today", "Resting today" on a quiet low day,
 * nothing at zero.
 */
export function TodaysEmber({ count, lowDay, stepping, className }: TodaysEmberProps) {
  const reduce = useReducedMotion();
  const scale = Math.min(0.85 + 0.05 * count, 1.1);
  const glow = Math.min(0.08 + 0.06 * count, 0.4);
  const transition = { duration: stepping && !reduce ? themeSeconds('--ember-dur-slow', 0.42) : 0 };
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="size-[56px] shrink-0 overflow-visible">
        <motion.circle
          cx="32"
          cy="40"
          r="26"
          className="fill-flame-core"
          initial={false}
          animate={{ opacity: glow }}
          transition={transition}
        />
        <motion.g
          style={{ originX: '50%', originY: '100%' }}
          initial={false}
          animate={{ scale }}
          transition={transition}
        >
          <path
            className="fill-flame"
            d="M32 6C36 15 47 22 47 37A15 15 0 0 1 17 37C17 29 21.5 23.5 25.5 19C26.5 23.5 28.5 26.5 30.8 27.3C30.3 20 30.7 12.5 32 6Z"
          />
          <path className="fill-flame-core" d="M32 30C35.3 34.2 39.5 37 39.5 42.5A7.5 7.5 0 0 1 24.5 42.5C24.5 37.8 28.3 34.5 32 30Z" />
        </motion.g>
      </svg>
      {count > 0 ? (
        <p className="text-[14px] leading-snug">{count} checked in today</p>
      ) : (
        lowDay && (
          <p className="flex items-center gap-1.5 text-[14px] leading-snug">
            <Moon aria-hidden className="size-[16px] shrink-0" />
            Resting today
          </p>
        )
      )}
    </div>
  );
}
