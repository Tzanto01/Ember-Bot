/** "Morning routine" for a routine named "Morning"; a name that already ends in "routine" stays as it is. */
export function routineTitle(name: string): string {
  return /routine$/i.test(name.trim()) ? name.trim() : `${name.trim()} routine`;
}
