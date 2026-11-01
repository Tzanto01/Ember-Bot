import { cn } from '@/lib/utils';

/** Envelope with a small spark (the sign-up "Check your inbox" view). Decorative. */
export function EnvelopeSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 72"
      aria-hidden="true"
      focusable="false"
      className={cn('h-[72px] w-[96px] shrink-0', className)}
    >
      <rect x="8" y="20" width="64" height="44" rx="6" className="fill-muted stroke-muted-foreground" strokeWidth="2" />
      <path d="M10 24 40 46 70 24" className="fill-none stroke-muted-foreground" strokeWidth="2" strokeLinejoin="round" />
      <path d="M80 2 83 11 92 14 83 17 80 26 77 17 68 14 77 11Z" className="fill-flame" />
      <circle cx="88" cy="30" r="3" className="fill-flame-core" />
    </svg>
  );
}

/** Shield with a leaf (the consent screen). Decorative. */
export function ShieldLeaf({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 80"
      aria-hidden="true"
      focusable="false"
      className={cn('size-[64px] shrink-0', className)}
    >
      <path
        d="M40 6 68 16V38C68 56 56 68 40 74 24 68 12 56 12 38V16Z"
        className="fill-muted stroke-muted-foreground"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M38 60C26 52 27 33 47 24 53 37 51 53 38 60Z" className="fill-done" />
      <path d="M38 60 46 32" className="fill-none stroke-muted-foreground" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
