/**
 * Ember's pitch, in one place so it can be swapped. `web/index.html` repeats `title` and `description` as plain text
 * (it can't import this module); keep them identical.
 */
export const pitch = {
  hero: 'A small campfire for big moments.',
  description: 'A calm companion for hard moments and gentle days.',
  habitsLine: 'And on the other days: gentle habits.',
  title: 'A small campfire for big moments',
} as const;
