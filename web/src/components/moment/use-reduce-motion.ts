import { useSyncExternalStore } from 'react';
import { useCalmMode } from '@/lib/theme';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia?.(query);
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

/** True while the user asks for reduced motion or calm mode is on; follows changes live. */
export function useReduceMotion(): boolean {
  const reduce = useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
  return useCalmMode() || reduce;
}
