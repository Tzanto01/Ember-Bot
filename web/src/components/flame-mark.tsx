import { cn } from '@/lib/utils';

/** The Ember flame logo in `--flame` / `--flame-core`. Decorative; size it with `className` (28 px by default). */
export function FlameMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="12 2 40 54"
      aria-hidden="true"
      focusable="false"
      className={cn('inline-block size-[28px] shrink-0 overflow-visible', className)}
    >
      <g className="ember-fire ember-fire--mark">
        <path
          className="fill-flame"
          d="M32 4C36 14 48 22 48 38A16 16 0 0 1 16 38C16 29 21 23 25 18C26 23 28 26 30.5 27C30 19 30.5 11 32 4Z"
        />
        <path className="ember-core ember-core--mark fill-flame-core" d="M32 30C35.5 34.5 40 37.5 40 43.5A8 8 0 0 1 24 43.5C24 38.5 28 35 32 30Z" />
      </g>
    </svg>
  );
}
