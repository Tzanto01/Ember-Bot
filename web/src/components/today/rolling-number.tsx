import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { themeSeconds } from './reward';

const variants: Variants = {
  enter: (duration: number) => (duration ? { y: '100%', opacity: 0 } : { y: 0, opacity: 1 }),
  center: { y: 0, opacity: 1 },
  exit: (duration: number) => ({ y: duration ? '-100%' : 0, opacity: 0, transition: { duration } }),
};

/** A number that rolls (old value up and out, new value in, `--ember-dur`) only while `roll` is true. */
export function RollingNumber({ value, roll }: { value: number; roll: boolean }) {
  const reduce = useReducedMotion();
  const duration = roll && !reduce ? themeSeconds('--ember-dur', 0.22) : 0;
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={duration}>
        <motion.span
          key={value}
          custom={duration}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration, ease: 'easeOut' }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
