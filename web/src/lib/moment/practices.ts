import de from '@/content/practices.de.json';
import en from '@/content/practices.en.json';
import { currentLanguage } from '@/lib/i18n';
import type { MomentState, Practice } from './types';

const content = { en: en as Practice[], de: de as Practice[] };

/** Every practice in the current language, in file order. */
export function practices(): Practice[] {
  return content[currentLanguage()];
}

/** The practices whose `states` include `state`, in file order. */
export function practicesFor(state: MomentState): Practice[] {
  return practices().filter((practice) => practice.states.includes(state));
}

/** The paced-breathing practice ("Just breathe with me" and "Not sure"). */
export function breathingPractice(): Practice {
  return practices().find((practice) => practice.id === 'paced-breathing')!;
}
