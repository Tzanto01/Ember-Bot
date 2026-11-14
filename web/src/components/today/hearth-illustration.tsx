/** Empty Today and the moment flow: a small hearth of stones with a low flame, glowing coals and two sparks. Decorative, token colours only. */
export function HearthIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-calm-hide className="size-[96px]">
      <ellipse cx="48" cy="78" rx="34" ry="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="18" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="39" y="64" width="18" height="12" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="60" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <ellipse cx="48" cy="60" rx="9" ry="3" className="ember-coal fill-[color-mix(in_oklch,var(--flame)_60%,transparent)]" />
      <g className="ember-flicker ember-flicker--hearth">
        <path d="M48 42C51 46.5 55 49 55 52.5A7 7 0 0 1 41 52.5C41 48.5 44.5 46 48 42Z" className="fill-flame" />
        <path d="M48 47.5C50 50 51.5 51.5 51.5 53.5A3.5 3.5 0 0 1 44.5 53.5C44.5 51.5 46 50 48 47.5Z" className="fill-flame-core" />
      </g>
      <path d="M30 62 L48 50 L66 62" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 58 L56 54" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <circle cx="52" cy="38" r="3.5" className="ember-spark fill-flame-core" />
      <circle cx="44" cy="28" r="1.8" className="ember-spark ember-spark--late fill-flame" />
    </svg>
  );
}
