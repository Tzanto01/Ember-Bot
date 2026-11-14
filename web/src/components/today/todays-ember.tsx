import { Moon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { themeSeconds } from './reward';

export interface TodaysEmberProps {
  /** Habits checked in today. */
  count: number;
  lowDay: boolean;
  /** Every habit due today is checked in. */
  allDone?: boolean;
  /** True while a check-in reward plays; only then does the flame animate its step. */
  stepping: boolean;
  className?: string;
}

/**
 * The Today's ember summary: a small campfire whose flames grow one step per check-in today (0.85 + 0.05 each, capped at 1.1,
 * glow rising with it) and a plain line of text: "{n} checked in today" (plus "That's everything for today." once
 * all are done), "Resting today" on a quiet low day, "Nothing checked in yet today" at zero otherwise.
 */
export function TodaysEmber({ count, lowDay, allDone = false, stepping, className }: TodaysEmberProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const scale = Math.min(0.85 + 0.05 * count, 1.1);
  const glow = Math.min(0.08 + 0.06 * count, 0.4);
  const transition = { duration: stepping && !reduce ? themeSeconds('--ember-dur-slow', 0.42) : 0 };
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" data-calm-hide className="size-[64px] shrink-0 overflow-visible">
        <g className="ember-coal">
          <motion.circle
            cx="32"
            cy="40"
            r="26"
            className="fill-flame-core"
            initial={false}
            animate={{ opacity: glow }}
            transition={transition}
          />
        </g>
        <ellipse cx="32" cy="53" rx="11" ry="3" className="ember-coal fill-[color-mix(in_oklch,var(--flame)_60%,transparent)]" />
        <motion.g
          style={{ originX: '50%', originY: '100%' }}
          initial={false}
          animate={{ scale }}
          transition={transition}
        >
          <path
            className="ember-fire ember-fire--b fill-[color-mix(in_oklch,var(--flame)_75%,transparent)]"
            d="M41 30C44.5 35 48.5 38.5 48.5 44.5A7.5 7.5 0 0 1 33.5 44.5C33.5 39 37 35 41 30Z"
          />
          <path
            className="ember-fire fill-flame"
            d="M30 10C34 18 44 25 44 38A13 13 0 0 1 18 38C18 31 22 26 25.5 22C26.5 26 28 28.5 30 29.3C29.5 23 29 16.5 30 10Z"
          />
          <path className="ember-core fill-flame-core" d="M31 32C34 35.7 37.5 38.3 37.5 43A6.5 6.5 0 0 1 24.5 43C24.5 38.8 27.8 35.8 31 32Z" />
        </motion.g>
        <path d="M14 57L50 50M14 50L50 57" className="fill-none stroke-muted-foreground" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cx="10" cy="58" rx="5" ry="3.5" className="fill-[color-mix(in_oklch,var(--muted-foreground)_45%,transparent)]" />
        <ellipse cx="54" cy="58" rx="5" ry="3.5" className="fill-[color-mix(in_oklch,var(--muted-foreground)_45%,transparent)]" />
        <circle cx="35" cy="14" r="1.6" className="ember-spark fill-flame-core" />
        <circle cx="27" cy="18" r="1.2" className="ember-spark ember-spark--late fill-flame" />
        <circle cx="40" cy="22" r="1.4" className="ember-spark ember-spark--last fill-flame-core" />
      </svg>
      {count > 0 ? (
        <p className="text-[0.875rem] leading-snug">
          {t('today.ember.count', { n: count })}
          {allDone && (
            <>
              <br />
              {t('today.ember.allDone')}
            </>
          )}
        </p>
      ) : lowDay ? (
        <p className="flex items-center gap-1.5 text-[0.875rem] leading-snug">
          <Moon aria-hidden className="size-[16px] shrink-0" />
          {t('today.ember.resting')}
        </p>
      ) : (
        <p className="text-[0.875rem] leading-snug">{t('today.ember.none')}</p>
      )}
    </div>
  );
}
