/** Empty Today and the moment flow: a small hearth of stones with two flickering flame tongues, glowing coals and rising sparks. Decorative, token colours only. */
export function HearthIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-calm-hide className="size-[96px]">
      <ellipse cx="48" cy="78" rx="34" ry="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="18" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="39" y="64" width="18" height="12" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <rect x="60" y="62" width="18" height="13" rx="6" className="fill-[color-mix(in_oklch,var(--muted-foreground)_35%,transparent)]" />
      <ellipse cx="48" cy="60" rx="9" ry="3" className="ember-coal fill-[color-mix(in_oklch,var(--flame)_60%,transparent)]" />
      <path d="M55 46C57.5 49 59.5 51 59.5 54A5 5 0 0 1 49.5 54C49.5 51 52 49 55 46Z" className="ember-fire ember-fire--b fill-[color-mix(in_oklch,var(--flame)_75%,transparent)]" />
      <path d="M48 38C52 44 57 47.5 57 53A9 9 0 0 1 39 53C39 47.5 43.5 44 48 38Z" className="ember-fire fill-flame" />
      <path d="M48 46.5C50.5 49.5 52.5 51.5 52.5 54.5A4.5 4.5 0 0 1 43.5 54.5C43.5 51.5 45.5 49.5 48 46.5Z" className="ember-core fill-flame-core" />
      <path d="M30 62 L48 50 L66 62" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 58 L56 54" className="fill-none stroke-muted-foreground" strokeWidth="3" strokeLinecap="round" />
      <circle cx="51" cy="36" r="2" className="ember-spark fill-flame-core" />
      <circle cx="45" cy="34" r="1.5" className="ember-spark ember-spark--late fill-flame" />
      <circle cx="54" cy="40" r="1.3" className="ember-spark ember-spark--last fill-flame-core" />
    </svg>
  );
}
