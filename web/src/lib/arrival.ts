import { useEffect, useState } from 'react';

/** How long a page's `data-arrive` stays on after a navigation; longer than the slowest arrival plus its stagger. */
export const arrivalWindowMs = 1200;

/**
 * True from the first render in a new section (the first segment of `path`) until `arrivalWindowMs` later, so the arrival
 * animation runs once per navigation between sections and never again on re-renders, refetches or moves inside one
 * section (Settings groups, History habits).
 */
export function useArrival(path: string): boolean {
  const pathname = `/${path.split('/')[1] ?? ''}`;
  const [arrival, setArrival] = useState({ pathname, on: true });
  if (arrival.pathname !== pathname) setArrival({ pathname, on: true });

  useEffect(() => {
    const timer = setTimeout(() => setArrival({ pathname, on: false }), arrivalWindowMs);
    return () => clearTimeout(timer);
  }, [pathname]);

  return arrival.pathname !== pathname || arrival.on;
}
