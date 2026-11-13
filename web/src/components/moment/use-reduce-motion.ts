import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia?.(query);
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

/** True while the user asks for reduced motion; follows changes live. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}
