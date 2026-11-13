/** Empty Today: a small unlit hearth of stones with one spark. Decorative, token colours only. */
export function HearthIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-calm-hide className="size-[96px]">
      <ellipse cx="48" cy="78" rx="34" ry="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="18" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="39" y="64" width="18" height="12" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="60" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <path d="M30 62 L48 50 L66 62" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 58 L56 54" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <circle cx="52" cy="38" r="3.5" className="fill-flame-core" />
      <circle cx="44" cy="28" r="1.8" className="fill-flame" />
    </svg>
  );
}
