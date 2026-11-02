/** Empty History: an open notebook whose page is a faint 7 × 3 grid of open cells with one done cell glowing. */
export function NotebookIllustration() {
  const cells = Array.from({ length: 21 }, (_, i) => ({ x: 26 + (i % 7) * 8, y: 34 + Math.floor(i / 7) * 8, i }));
  return (
    <svg viewBox="0 0 112 96" aria-hidden="true" focusable="false" className="h-[96px] w-[112px]">
      <path d="M8 22 Q32 14 56 22 L56 82 Q32 74 8 82 Z" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <path d="M104 22 Q80 14 56 22 L56 82 Q80 74 104 82 Z" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <path d="M56 22 L56 82" className="stroke-muted-foreground" strokeWidth="1.5" />
      {cells.map(({ x, y, i }) =>
        i === 10 ? (
          <g key={i}>
            <circle cx={x + 3} cy={y + 3} r="7" className="fill-flame-core" opacity="0.35" />
            <rect x={x} y={y} width="6" height="6" rx="1.5" className="fill-done" />
          </g>
        ) : (
          <rect
            key={i}
            x={x}
            y={y}
            width="6"
            height="6"
            rx="1.5"
            className="fill-none stroke-muted-foreground"
            strokeWidth="0.8"
            opacity="0.5"
          />
        ),
      )}
    </svg>
  );
}

/** The quiet desktop placeholder beside the calendar: a small calendar page. */
export function CalendarIllustration() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className="size-[48px]">
      <rect x="6" y="10" width="36" height="32" rx="6" className="fill-muted" />
      <rect x="6" y="10" width="36" height="9" rx="4" className="fill-muted-foreground" opacity="0.35" />
      <path d="M16 6 L16 14 M32 6 L32 14" className="stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <rect x="13" y="25" width="6" height="6" rx="1.5" className="fill-done" />
      <rect x="21" y="25" width="6" height="6" rx="1.5" className="fill-none stroke-muted-foreground" strokeWidth="1" />
      <rect x="29" y="25" width="6" height="6" rx="1.5" className="fill-none stroke-muted-foreground" strokeWidth="1" />
    </svg>
  );
}
