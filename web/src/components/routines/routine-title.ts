import { t } from '@/lib/i18n';

/** "Morning routine" for a routine named "Morning"; a name that already ends in "routine" stays as it is. */
export function routineTitle(name: string): string {
  return /routine$/i.test(name.trim()) ? name.trim() : t('routine.title', { name: name.trim() });
}
