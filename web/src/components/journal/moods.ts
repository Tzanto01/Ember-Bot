import { t } from '@/lib/i18n';
import { type BuiltinMood, builtinMoods, type MoodKey, type OwnMood } from '@/lib/models';

/** How a mood looks: an emoji (or null for an own mood without one) and its word. */
export interface MoodLook {
  key: MoodKey;
  emoji: string | null;
  label: string;
  archived: boolean;
}

const builtinLooks: Record<BuiltinMood, { emoji: string; label: string }> = {
  low: { emoji: '🌧️', get label() { return t('moods.low'); } },
  meh: { emoji: '☁️', get label() { return t('moods.meh'); } },
  okay: { emoji: '⛅', get label() { return t('moods.okay'); } },
  good: { emoji: '🌤️', get label() { return t('moods.good'); } },
  great: { emoji: '☀️', get label() { return t('moods.great'); } },
};

/** The look of `key`, using `own` for `custom:<id>`; an unknown own mood reads "Your own mood". */
export function moodLook(key: MoodKey, own: readonly OwnMood[]): MoodLook {
  if (!key.startsWith('custom:')) {
    return { key, archived: false, ...builtinLooks[key as BuiltinMood] };
  }
  const mood = own.find((m) => `custom:${m.id}` === key);
  return mood
    ? { key, emoji: mood.emoji, label: mood.label, archived: mood.archived }
    : { key, emoji: null, label: t('moods.ownMood'), archived: false };
}

/** The picker's choices: the five built-ins, the active own moods, and `current` when it is an archived one. */
export function moodChoices(own: readonly OwnMood[], current: MoodKey | null): MoodLook[] {
  const choices = builtinMoods.map((key) => moodLook(key, own));
  for (const mood of own) {
    const key: MoodKey = `custom:${mood.id}`;
    if (!mood.archived || key === current) choices.push(moodLook(key, own));
  }
  return choices;
}

/** One emoji grapheme (for own moods). */
export function isSingleEmoji(value: string): boolean {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}
