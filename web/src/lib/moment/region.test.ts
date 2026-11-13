import { describe, expect, it } from 'vitest';
import { linesForRegion, pickRegion, regionForCountry } from './region';

describe('pickRegion', () => {
  it('takes the region of the first language tag that has one', () => {
    expect(pickRegion(['de', 'de-AT', 'en-GB'], 'Europe/Berlin')).toBe('AT');
  });

  it('skips tags without a region or that do not parse, then falls back to the time zone', () => {
    expect(pickRegion(['de', 'not a tag!'], 'Europe/Zurich')).toBe('CH');
    expect(pickRegion(['en'], 'America/Chicago')).toBe('US');
    expect(pickRegion(['fr'], 'Europe/Paris')).toBe('EU');
    expect(pickRegion(['en'], 'Europe/Dublin')).toBe('IE');
  });

  it('takes Ireland from an en-IE tag', () => {
    expect(pickRegion(['en-IE'], undefined)).toBe('IE');
  });

  it('falls back to INTL when neither languages nor time zone tell', () => {
    expect(pickRegion([], undefined)).toBe('INTL');
    expect(pickRegion(['en'], 'Asia/Tokyo')).toBe('INTL');
  });

  it('maps an EU member without its own entry to EU and any other unlisted region to INTL', () => {
    expect(pickRegion(['fr-FR'], 'Europe/London')).toBe('EU');
    expect(pickRegion(['ja-JP'], 'Europe/Berlin')).toBe('INTL');
  });
});

describe('linesForRegion', () => {
  const numbers = (region: Parameters<typeof linesForRegion>[0]) =>
    linesForRegion(region).flatMap((line) => line.numbers);

  it('adds 112 exactly once for EU member regions', () => {
    expect(numbers('DE')).toEqual(['0800 111 0 111', '0800 111 0 222', '116 123', '112']);
    expect(numbers('AT')).toEqual(['142', '112']);
    expect(numbers('EU')).toEqual(['112']);
    expect(numbers('IE')).toEqual(['116 123', '999', '112']);
  });

  it('shows only the own lines outside the EU', () => {
    expect(numbers('CH')).toEqual(['143']);
    expect(numbers('US')).toEqual(['988', '911']);
    expect(numbers('GB')).toEqual(['116 123', '999']);
    expect(linesForRegion('INTL').map((line) => line.region)).toEqual(['INTL']);
  });
});

describe('regionForCountry', () => {
  it('maps a lower-case country code to its region', () => {
    expect(regionForCountry('ie')).toBe('IE');
  });
});
