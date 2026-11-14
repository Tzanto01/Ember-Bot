import { useEffect, useState } from 'react';

/** How long a page's `data-arrive` stays on after a navigation; longer than the slowest arrival plus its stagger. */
export const arrivalWindowMs = 1200;

/**
 * True from the first render on a new `pathname` until `arrivalWindowMs` later, so the arrival animation runs once per
 * navigation and never again on re-renders or refetches.
 */
export function useArrival(pathname: string): boolean {
  const [arrival, setArrival] = useState({ pathname, on: true });
  if (arrival.pathname !== pathname) setArrival({ pathname, on: true });

  useEffect(() => {
    const timer = setTimeout(() => setArrival({ pathname, on: false }), arrivalWindowMs);
    return () => clearTimeout(timer);
  }, [pathname]);

  return arrival.pathname !== pathname || arrival.on;
}
