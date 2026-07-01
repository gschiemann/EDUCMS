import { parseIcs, IcsParseError, MAX_CALENDAR_EVENTS, EXPAND_WINDOW_DAYS, ONE_OFF_HORIZON_DAYS } from './ics-parser';

// Fixed "now" so recurrence-expansion windows are deterministic across runs.
const NOW = new Date('2026-07-01T00:00:00Z');

function wrap(vevents: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n${vevents}END:VCALENDAR\r\n`;
}

describe('parseIcs — basic VEVENT parsing', () => {
  it('parses a single timed event with DTSTART/DTEND/SUMMARY/LOCATION', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260705T140000Z\r\n' +
        'DTEND:20260705T150000Z\r\n' +
        'SUMMARY:Staff Meeting\r\n' +
        'LOCATION:Room 204\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      title: 'Staff Meeting',
      start: '2026-07-05T14:00:00.000Z',
      end: '2026-07-05T15:00:00.000Z',
      location: 'Room 204',
      allDay: false,
    });
  });

  it('parses an all-day event (VALUE=DATE)', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART;VALUE=DATE:20260710\r\n' +
        'SUMMARY:No School\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].allDay).toBe(true);
    expect(result.events[0].start).toBe('2026-07-10T00:00:00.000Z');
    expect(result.events[0].end).toBeNull();
  });

  it('unescapes ICS TEXT values (\\, \\; \\n)', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260705T140000Z\r\n' +
        'SUMMARY:Comma\\, semicolon\\; and\\nnewline\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events[0].title).toBe('Comma, semicolon; and\nnewline');
  });

  it('handles line folding (continuation lines starting with a space)', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260705T140000Z\r\n' +
        'SUMMARY:This is a very long summary that got fold\r\n' +
        ' ed across two lines per RFC 5545\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events[0].title).toBe('This is a very long summary that got folded across two lines per RFC 5545');
  });

  it('skips a VEVENT with no DTSTART rather than crashing', () => {
    const ics = wrap('BEGIN:VEVENT\r\nSUMMARY:No Start\r\nEND:VEVENT\r\n');
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(0);
  });

  it('defaults a missing SUMMARY to a placeholder title', () => {
    const ics = wrap('BEGIN:VEVENT\r\nDTSTART:20260705T140000Z\r\nEND:VEVENT\r\n');
    const result = parseIcs(ics, NOW);
    expect(result.events[0].title).toBe('(untitled event)');
  });

  it('skips nested VALARM blocks without treating them as events', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260705T140000Z\r\n' +
        'SUMMARY:Has Alarm\r\n' +
        'BEGIN:VALARM\r\n' +
        'TRIGGER:-PT15M\r\n' +
        'ACTION:DISPLAY\r\n' +
        'END:VALARM\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Has Alarm');
  });

  it('sorts events chronologically regardless of file order', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nDTSTART:20260710T100000Z\r\nSUMMARY:Later\r\nEND:VEVENT\r\n' +
        'BEGIN:VEVENT\r\nDTSTART:20260703T100000Z\r\nSUMMARY:Earlier\r\nEND:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events.map((e) => e.title)).toEqual(['Earlier', 'Later']);
  });
});

describe('parseIcs — recurrence (RRULE) expansion', () => {
  it('expands a simple WEEKLY recurrence within the window', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260701T180000Z\r\n' +
        'DTEND:20260701T190000Z\r\n' +
        'SUMMARY:Weekly Practice\r\n' +
        'RRULE:FREQ=WEEKLY;INTERVAL=1\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    // 30-day window / 7-day cadence ≈ 4-5 occurrences.
    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.events.every((e) => e.title === 'Weekly Practice')).toBe(true);
    expect(result.meta.recurringEventCount).toBe(1);
    expect(result.meta.recurrenceExpansionDays).toBe(EXPAND_WINDOW_DAYS);
  });

  it('honors COUNT to cap expanded occurrences', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260701T180000Z\r\n' +
        'SUMMARY:Daily x3\r\n' +
        'RRULE:FREQ=DAILY;COUNT=3\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(3);
  });

  it('honors UNTIL to bound expansion', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260701T180000Z\r\n' +
        'SUMMARY:Daily until 7/4\r\n' +
        'RRULE:FREQ=DAILY;UNTIL=20260704T180000Z\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    // Jul 1, 2, 3, 4 inclusive = 4 occurrences.
    expect(result.events).toHaveLength(4);
  });

  it('flags hasUnexpandedRecurrence when RRULE has unsupported modifiers (BYDAY)', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260701T180000Z\r\n' +
        'SUMMARY:MWF Practice\r\n' +
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.meta.hasUnexpandedRecurrence).toBe(true);
    // Still returns SOMETHING — never silently drops the event entirely.
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('still surfaces the DTSTART occurrence for a totally unparseable RRULE', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20260701T180000Z\r\n' +
        'SUMMARY:Weird Rule\r\n' +
        'RRULE:FREQ=SECONDLY\r\n' + // unsupported FREQ
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.meta.hasUnexpandedRecurrence).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Weird Rule');
  });

  it('never spins forever on an unbounded recurrence (window + iteration cap)', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20200101T000000Z\r\n' + // years in the past, no COUNT/UNTIL
        'SUMMARY:Forever Daily\r\n' +
        'RRULE:FREQ=DAILY\r\n' +
        'END:VEVENT\r\n',
    );
    const start = Date.now();
    const result = parseIcs(ics, NOW);
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(result.events.length).toBeLessThanOrEqual(MAX_CALENDAR_EVENTS);
  });

  it('caps total events at MAX_CALENDAR_EVENTS across multiple recurring VEVENTs', () => {
    const many = Array.from(
      { length: 10 },
      (_, i) =>
        `BEGIN:VEVENT\r\nDTSTART:2026070${(i % 9) + 1}T100000Z\r\nSUMMARY:Daily ${i}\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n`,
    ).join('');
    const result = parseIcs(wrap(many), NOW);
    expect(result.events.length).toBeLessThanOrEqual(MAX_CALENDAR_EVENTS);
  });
});

describe('parseIcs — one-off events relative to the window', () => {
  it('keeps a future one-off event even beyond the 30-day expansion window', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\n' +
        'DTSTART:20261001T100000Z\r\n' + // 3 months out
        'SUMMARY:Homecoming\r\n' +
        'END:VEVENT\r\n',
    );
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Homecoming');
  });

  it('drops a one-off event far in the past', () => {
    const ics = wrap('BEGIN:VEVENT\r\nDTSTART:20200101T100000Z\r\nSUMMARY:Ancient\r\nEND:VEVENT\r\n');
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(0);
  });

  it('drops a one-off event far beyond ONE_OFF_HORIZON_DAYS (regression: Google holiday-calendar flood)', () => {
    // Real-world bug caught via live verification against
    // https://calendar.google.com/.../en.usa%23holiday.../basic.ics — that
    // feed lists holidays YEARS into the future with no RRULE (each holiday
    // is its own one-off VEVENT), which without an upper horizon flooded a
    // 30-day-window calendar widget with 155 rows. Anything beyond the
    // horizon must be excluded, not just anything before "yesterday".
    const farFutureDate = new Date(NOW.getTime() + (ONE_OFF_HORIZON_DAYS + 30) * 24 * 60 * 60 * 1000);
    const yyyymmdd = farFutureDate.toISOString().slice(0, 10).replace(/-/g, '');
    const ics = wrap(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${yyyymmdd}\r\nSUMMARY:Some Holiday Next Year\r\nEND:VEVENT\r\n`);
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(0);
  });

  it('keeps a one-off event just inside ONE_OFF_HORIZON_DAYS', () => {
    const justInside = new Date(NOW.getTime() + (ONE_OFF_HORIZON_DAYS - 5) * 24 * 60 * 60 * 1000);
    const yyyymmdd = justInside.toISOString().slice(0, 10).replace(/-/g, '');
    const ics = wrap(`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${yyyymmdd}\r\nSUMMARY:Within Horizon\r\nEND:VEVENT\r\n`);
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(1);
  });
});

describe('parseIcs — malformed input', () => {
  it('throws IcsParseError on non-ICS input', () => {
    expect(() => parseIcs('not an ics file')).toThrow(IcsParseError);
  });

  it('throws IcsParseError on empty string', () => {
    expect(() => parseIcs('')).toThrow(IcsParseError);
  });

  it('tolerates a VEVENT with malformed DTSTART by skipping it', () => {
    const ics = wrap('BEGIN:VEVENT\r\nDTSTART:not-a-date\r\nSUMMARY:Bad\r\nEND:VEVENT\r\n');
    const result = parseIcs(ics, NOW);
    expect(result.events).toHaveLength(0);
  });

  it('handles a VCALENDAR with zero VEVENTs', () => {
    const result = parseIcs(wrap(''), NOW);
    expect(result.events).toEqual([]);
    expect(result.meta.recurringEventCount).toBe(0);
  });
});
