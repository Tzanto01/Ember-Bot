import './reward.css';

const keywords = ['glow', 'fill', 'rise'] as const;

/** A theme's check-in reward (`--ember-reward`); `none` and unknown values mean no reward. */
export type RewardKeyword = (typeof keywords)[number];

/**
 * Reads the theme's `--ember-reward` keyword at the moment of a check-in tap.
 * Null for `none`, an unknown value, or when the user prefers reduced motion.
 */
export function readReward(reducedMotion: boolean | null): RewardKeyword | null {
  if (reducedMotion) return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ember-reward').trim();
  return (keywords as readonly string[]).includes(value) ? (value as RewardKeyword) : null;
}

/** A theme duration token (`--ember-dur`, `--ember-dur-slow`) in seconds, for Motion transitions. */
export function themeSeconds(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') ? value / 1000 : value;
}
