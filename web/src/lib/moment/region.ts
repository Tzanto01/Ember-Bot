import crisisLines from '@/content/crisis-lines.json';

/** A region with its own entry in `content/crisis-lines.json`. */
export type CrisisRegion = 'DE' | 'AT' | 'CH' | 'GB' | 'IE' | 'US' | 'EU' | 'INTL';

/** One entry of `content/crisis-lines.json`. */
export interface CrisisLine {
  region: CrisisRegion;
  name: string;
  numbers: string[];
  hours: string;
  url?: string;
  /** The day the entry was last checked, `YYYY-MM-DD`. */
  checked: string;
}

/** Every crisis line in file order. */
export const CRISIS_LINES = crisisLines as CrisisLine[];

/** The country select's options in file order, with readable names. */
export const CRISIS_REGIONS: readonly { region: CrisisRegion; label: string }[] = [
  { region: 'DE', label: 'Germany' },
  { region: 'AT', label: 'Austria' },
  { region: 'CH', label: 'Switzerland' },
  { region: 'GB', label: 'United Kingdom' },
  { region: 'IE', label: 'Ireland' },
  { region: 'US', label: 'United States' },
  { region: 'EU', label: 'Elsewhere in the EU' },
  { region: 'INTL', label: 'Somewhere else' },
];

const listed = new Set<string>(['DE', 'AT', 'CH', 'GB', 'IE', 'US']);

const euMembers = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

const usZones = [
  'America/New_York',
  'America/Detroit',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Boise',
  'America/Indiana/Indianapolis',
  'Pacific/Honolulu',
];

const euZones = [
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Bratislava',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Lisbon',
  'Europe/Ljubljana',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Malta',
  'Europe/Nicosia',
  'Asia/Nicosia',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Riga',
  'Europe/Rome',
  'Europe/Sofia',
  'Europe/Stockholm',
  'Europe/Tallinn',
  'Europe/Vilnius',
  'Europe/Warsaw',
  'Europe/Zagreb',
  'Europe/Mariehamn',
  'Europe/Busingen',
];

const zoneRegions = new Map<string, CrisisRegion>([
  ['Europe/Berlin', 'DE'],
  ['Europe/Vienna', 'AT'],
  ['Europe/Zurich', 'CH'],
  ['Europe/London', 'GB'],
  ['Europe/Dublin', 'IE'],
  ...usZones.map((zone) => [zone, 'US'] as const),
  ...euZones.map((zone) => [zone, 'EU'] as const),
]);

/** Maps an ISO 3166 country code to its crisis region: listed ones as is, other EU members to `EU`, the rest to `INTL`. */
export function regionForCountry(country: string): CrisisRegion {
  const code = country.toUpperCase();
  if (listed.has(code)) return code as CrisisRegion;
  return euMembers.has(code) ? 'EU' : 'INTL';
}

/**
 * Picks the crisis region: the first language tag with a region wins (tags that don't parse or carry no region
 * are skipped), else the time zone, else `INTL`.
 */
export function pickRegion(
  languages: readonly string[],
  timeZone: string | undefined,
): CrisisRegion {
  for (const tag of languages) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(tag).region;
    } catch {
      continue;
    }
    if (region) return regionForCountry(region);
  }
  return (timeZone && zoneRegions.get(timeZone)) || 'INTL';
}

/** `pickRegion` for this browser's `navigator.languages` and time zone. */
export function detectRegion(): CrisisRegion {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return pickRegion(typeof navigator === 'undefined' ? [] : (navigator.languages ?? []), timeZone);
}

/** The lines to show for a region: its own entries, plus the EU 112 entry for EU member regions (once). */
export function linesForRegion(
  region: CrisisRegion,
  lines: readonly CrisisLine[] = CRISIS_LINES,
): CrisisLine[] {
  const own = lines.filter((line) => line.region === region);
  if (region === 'EU' || !euMembers.has(region)) return own;
  return [...own, ...lines.filter((line) => line.region === 'EU')];
}
