import { t } from '@/lib/i18n';

/**
 * Ember's pitch in the current language (keys `pitch.*`), in one place so it can be swapped. `web/index.html` (title
 * and meta tags) and `web/public/manifest.webmanifest` (`description`) repeat the English `title` and `description` as
 * plain text (they can't import this module); keep them identical.
 */
export const pitch = {
  get hero() {
    return t('pitch.hero');
  },
  get description() {
    return t('pitch.description');
  },
  get habitsLine() {
    return t('pitch.habitsLine');
  },
  get title() {
    return t('pitch.title');
  },
};
