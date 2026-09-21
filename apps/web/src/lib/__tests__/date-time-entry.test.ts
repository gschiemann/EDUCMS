import {
  WEEK_STARTS_ON,
  buildMonthGrid,
  formatDateDisplay,
  formatTimeDisplay,
  localeDateOrder,
  nearestOptionIndex,
  parseTypedDate,
  parseTypedTime,
  timeOptions,
  toLocalIsoDate,
} from '../date-time-entry';

describe('toLocalIsoDate — the UTC "today" bug this replaces', () => {
  it('reads LOCAL calendar parts', () => {
    expect(toLocalIsoDate(new Date(2026, 8, 21, 23, 30))).toBe('2026-09-21');
    expect(toLocalIsoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('disagrees with toISOString().slice(0,10) west of Greenwich — which is the bug', () => {
    // ScheduleWindowFields computed `min` with the UTC slice, so after ~5pm
    // Pacific "today" became tomorrow and today fell out of range. Pin the
    // zone so this is a real assertion everywhere, not a UTC no-op on CI.
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const evening = new Date(2026, 8, 21, 23, 30);
      expect(evening.toISOString().slice(0, 10)).toBe('2026-09-22'); // the old, wrong answer
      expect(toLocalIsoDate(evening)).toBe('2026-09-21'); // the operator's actual today
    } finally {
      process.env.TZ = saved;
    }
  });
});

describe('parseTypedTime', () => {
  const rows: Array<[string, string | null]> = [
    // meridiem, loose and tight
    ['8a', '08:00'],
    ['8am', '08:00'],
    ['8 AM', '08:00'],
    ['8:30p', '20:30'],
    ['8:30 pm', '20:30'],
    ['8 a.m.', '08:00'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
    // explicit 24-hour
    ['14:00', '14:00'],
    ['1400', '14:00'],
    ['14', '14:00'],
    ['1530', '15:30'],
    ['0', '00:00'],
    // a leading zero opts out of the business-hours guess
    ['0830', '08:30'],
    ['08:30', '08:30'],
    ['08', '08:00'],
    // the business-hours guess: 7–11 AM, 12 PM, 1–6 PM
    ['830', '08:30'],
    ['3', '15:00'],
    ['130', '13:30'],
    ['9', '09:00'],
    ['12', '12:00'],
    ['6', '18:00'],
    ['7', '07:00'],
    // not times
    ['24', null],
    ['25:00', null],
    ['8:75', null],
    ['13pm', null],
    ['abc', null],
    ['', null],
    ['  ', null],
    ['pm', null],
  ];

  it.each(rows)('%j → %j', (input, expected) => {
    expect(parseTypedTime(input)).toBe(expected);
  });

  it('round-trips its own display form', () => {
    for (const hhmm of ['00:00', '08:30', '12:00', '15:45', '23:59']) {
      expect(parseTypedTime(formatTimeDisplay(hhmm, 'en-US'))).toBe(hhmm);
    }
  });
});

describe('formatTimeDisplay', () => {
  it('formats 12-hour in en-US', () => {
    expect(formatTimeDisplay('08:00', 'en-US')).toBe('8:00 AM');
    expect(formatTimeDisplay('15:30', 'en-US')).toBe('3:30 PM');
    expect(formatTimeDisplay('00:00', 'en-US')).toBe('12:00 AM');
    expect(formatTimeDisplay('12:00', 'en-US')).toBe('12:00 PM');
  });

  it('uses a plain ASCII space before AM/PM whatever ICU emits', () => {
    expect(formatTimeDisplay('08:00', 'en-US')).not.toMatch(/[  ]/);
  });

  it('returns empty for empty or malformed input', () => {
    expect(formatTimeDisplay('', 'en-US')).toBe('');
    expect(formatTimeDisplay('nope', 'en-US')).toBe('');
    expect(formatTimeDisplay('25:00', 'en-US')).toBe('');
  });
});

describe('timeOptions / nearestOptionIndex', () => {
  it('produces 96 quarter-hour options', () => {
    const o = timeOptions();
    expect(o).toHaveLength(96);
    expect(o[0]).toBe('00:00');
    expect(o[1]).toBe('00:15');
    expect(o[32]).toBe('08:00');
    expect(o[95]).toBe('23:45');
  });

  it('honours a different step', () => {
    expect(timeOptions(30)).toHaveLength(48);
    expect(timeOptions(60)[13]).toBe('13:00');
  });

  it('finds the closest option', () => {
    const o = timeOptions();
    expect(nearestOptionIndex('08:00', o)).toBe(32);
    expect(nearestOptionIndex('08:05', o)).toBe(32);
    expect(nearestOptionIndex('08:12', o)).toBe(33); // 08:15
    expect(o[nearestOptionIndex('23:59', o)]).toBe('23:45');
  });

  it('answers -1 rather than guessing when there is no time', () => {
    expect(nearestOptionIndex('', timeOptions())).toBe(-1);
    expect(nearestOptionIndex('nope', timeOptions())).toBe(-1);
    expect(nearestOptionIndex('08:00', [])).toBe(-1);
  });
});

describe('localeDateOrder', () => {
  it('reads the numeric order out of the locale', () => {
    expect(localeDateOrder('en-US')).toBe('mdy');
    expect(localeDateOrder('en-GB')).toBe('dmy');
    expect(localeDateOrder('de-DE')).toBe('dmy');
  });

  it('falls back to mdy on a locale Intl refuses', () => {
    expect(localeDateOrder('not a tag!!')).toBe('mdy');
  });
});

describe('parseTypedDate', () => {
  const today = '2026-09-21';
  const p = (text: string, extra: { min?: string; order?: 'mdy' | 'dmy' } = {}) =>
    parseTypedDate(text, { today, ...extra });

  it('accepts ISO', () => {
    expect(p('2026-10-12')).toBe('2026-10-12');
  });

  it('accepts numeric with every separator, mdy by default', () => {
    expect(p('10/12/2026')).toBe('2026-10-12');
    expect(p('10/12/26')).toBe('2026-10-12');
    expect(p('10-12-2026')).toBe('2026-10-12');
    expect(p('10.12.2026')).toBe('2026-10-12');
  });

  it('reads numeric the other way round when the locale does', () => {
    expect(p('10/12/2026', { order: 'dmy' })).toBe('2026-12-10');
    expect(p('12/10/2026', { order: 'dmy' })).toBe('2026-10-12');
  });

  it('rolls a year-less date forward past the floor', () => {
    expect(p('10/12')).toBe('2026-10-12'); // later this year
    expect(p('9/1')).toBe('2027-09-01'); // already past today → next year
    expect(p('9/1', { min: '2026-01-01' })).toBe('2026-09-01'); // floor allows it
  });

  it('accepts month names either way round', () => {
    expect(p('Oct 12')).toBe('2026-10-12');
    expect(p('October 12')).toBe('2026-10-12');
    expect(p('Oct 12 2026')).toBe('2026-10-12');
    expect(p('Oct 12, 2026')).toBe('2026-10-12');
    expect(p('12 Oct')).toBe('2026-10-12');
    expect(p('12 October 2026')).toBe('2026-10-12');
    expect(p('Sept 3, 2027')).toBe('2027-09-03');
  });

  it('accepts today / tomorrow', () => {
    expect(p('today')).toBe('2026-09-21');
    expect(p('tomorrow')).toBe('2026-09-22');
    expect(parseTypedDate('tomorrow', { today: '2026-12-31' })).toBe('2027-01-01');
  });

  it('rejects impossible dates and garbage', () => {
    expect(p('Feb 30')).toBeNull();
    expect(p('2026-02-30')).toBeNull();
    expect(p('13/45/2026')).toBeNull();
    expect(p('2/30/2026')).toBeNull();
    expect(p('Ma 3')).toBeNull(); // ambiguous prefix (March / May)
    expect(p('banana')).toBeNull();
    expect(p('')).toBeNull();
    expect(p('  ')).toBeNull();
  });

  it('does NOT enforce min — the component does, so it can say why', () => {
    expect(p('2026-01-05', { min: '2026-09-21' })).toBe('2026-01-05');
  });

  // The field re-reads its own display text on commit. If that string does not
  // parse, an untouched valid date gets flagged the moment focus leaves it.
  it('round-trips its own display form', () => {
    for (const iso of ['2026-10-12', '2027-01-01', '2026-12-25', '2028-02-29']) {
      expect(parseTypedDate(formatDateDisplay(iso, 'en-US'), { today })).toBe(iso);
    }
  });

  it('tolerates a leading weekday however it is written', () => {
    expect(p('Mon, Oct 12, 2026')).toBe('2026-10-12');
    expect(p('Monday October 12 2026')).toBe('2026-10-12');
    expect(p('Mon. 10/12/2026')).toBe('2026-10-12');
  });

  it('does not let the weekday strip eat a month name', () => {
    expect(p('March 3, 2027')).toBe('2027-03-03');
    expect(p('May 4, 2027')).toBe('2027-05-04');
    expect(p('Sep 3, 2027')).toBe('2027-09-03');
  });
});

describe('formatDateDisplay', () => {
  it('formats from LOCAL parts', () => {
    expect(formatDateDisplay('2026-10-12', 'en-US')).toBe('Mon, Oct 12, 2026');
    expect(formatDateDisplay('2027-01-01', 'en-US')).toBe('Fri, Jan 1, 2027');
  });

  it('never slips a day west of Greenwich (the new Date(iso) trap)', () => {
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(formatDateDisplay('2026-10-12', 'en-US')).toBe('Mon, Oct 12, 2026');
    } finally {
      process.env.TZ = saved;
    }
  });

  it('returns empty for empty or malformed input', () => {
    expect(formatDateDisplay('', 'en-US')).toBe('');
    expect(formatDateDisplay('10/12/2026', 'en-US')).toBe('');
  });
});

describe('buildMonthGrid', () => {
  it('always returns 42 cells starting on the configured weekday', () => {
    const grid = buildMonthGrid(2026, 9, WEEK_STARTS_ON); // October 2026
    expect(grid).toHaveLength(42);
    expect(WEEK_STARTS_ON).toBe(0);
    // Oct 1 2026 is a Thursday, so a Sunday-start grid leads with Sep 27.
    expect(grid[0]).toEqual({ iso: '2026-09-27', day: 27, inMonth: false });
    expect(grid[4]).toEqual({ iso: '2026-10-01', day: 1, inMonth: true });
    expect(grid[34]).toEqual({ iso: '2026-10-31', day: 31, inMonth: true });
    expect(grid[41].inMonth).toBe(false);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('handles a month that starts exactly on the week start', () => {
    const grid = buildMonthGrid(2026, 10, 0); // Nov 1 2026 is a Sunday
    expect(grid[0]).toEqual({ iso: '2026-11-01', day: 1, inMonth: true });
  });

  it('handles February in a leap year', () => {
    const grid = buildMonthGrid(2028, 1, 0);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(29);
  });

  it('honours a Monday week start', () => {
    const grid = buildMonthGrid(2026, 9, 1);
    expect(grid[0].iso).toBe('2026-09-28'); // the Monday before Oct 1
  });
});
