import {
  COMMON_TIME_ZONES,
  describeTimeZone,
  formatUtcOffset,
  localTimeIn,
  timeZoneAbbreviation,
  timeZoneCity,
  timeZoneOptions,
} from '../time-zone-label';

const JAN = Date.UTC(2026, 0, 15, 20, 42); // 12:42 PST / 04:42+1 CST(Shanghai)
const JUL = Date.UTC(2026, 6, 15, 20, 42);

describe('time-zone labels', () => {
  it('formats the UTC offset the way people write it', () => {
    expect(formatUtcOffset('America/Los_Angeles', JAN)).toBe('UTC−8');
    expect(formatUtcOffset('America/Los_Angeles', JUL)).toBe('UTC−7');
    expect(formatUtcOffset('Asia/Shanghai', JAN)).toBe('UTC+8');
    expect(formatUtcOffset('Asia/Kolkata', JAN)).toBe('UTC+5:30');
    expect(formatUtcOffset('UTC', JAN)).toBe('UTC');
    expect(formatUtcOffset('Nope/Nope', JAN)).toBeNull();
  });

  it('describes a zone with its abbreviation and offset, id first', () => {
    expect(describeTimeZone('America/Los_Angeles', JUL)).toBe('America/Los_Angeles · PDT (UTC−7)');
    expect(describeTimeZone('America/Los_Angeles', JAN)).toBe('America/Los_Angeles · PST (UTC−8)');
    // Shanghai's short name is "GMT+8" in en-US — the offset already says it, so no duplicate.
    expect(describeTimeZone('Asia/Shanghai', JAN)).toBe('Asia/Shanghai · (UTC+8)');
    expect(describeTimeZone('Nope/Nope', JAN)).toBe('Nope/Nope');
  });

  it('abbreviation, city and local time are honest about unknown zones', () => {
    expect(timeZoneAbbreviation('America/New_York', JAN)).toBe('EST');
    expect(timeZoneAbbreviation('Nope/Nope', JAN)).toBeNull();
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
    expect(localTimeIn('America/Los_Angeles', JAN)).toBe('12:42 PM');
    expect(localTimeIn('Asia/Shanghai', JAN)).toBe('4:42 AM');
    expect(localTimeIn('Nope/Nope', JAN)).toBeNull();
  });

  it('the picker list starts with the common zones and contains only usable ones, no duplicates', () => {
    const options = timeZoneOptions();
    expect(options.slice(0, COMMON_TIME_ZONES.length)).toEqual([...COMMON_TIME_ZONES]);
    expect(new Set(options).size).toBe(options.length);
    expect(options).toContain('Asia/Shanghai');
    expect(options.length).toBeGreaterThanOrEqual(COMMON_TIME_ZONES.length);
  });
});
