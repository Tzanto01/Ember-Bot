import content from '@/content/practices.json';
import type { MomentState, Practice } from './types';

/** Every practice, in file order. */
export const practices = content as Practice[];

/** The practices whose `states` include `state`, in file order. */
export function practicesFor(state: MomentState): Practice[] {
  return practices.filter((practice) => practice.states.includes(state));
}

/** The paced-breathing practice ("Just breathe with me" and "Not sure"). */
export const breathingPractice = practices.find((practice) => practice.id === 'paced-breathing')!;
