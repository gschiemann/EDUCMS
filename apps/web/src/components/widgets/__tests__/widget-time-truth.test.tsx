/**
 * W02 — A WIDGET MAY NOT INVENT A TIME.
 *
 * Four widgets printed a time claim that nothing backed, and each one of them
 * was wrong in a way an operator could not see from the builder:
 *
 *   BELL_SCHEDULE       "NOW" from `floor(currentHour - 8)` — the index of the
 *                       hour since 08:00, never the operator's period times.
 *   ROOM_SCHEDULE       "Free for 32 min" — a string constant.
 *   WAIT_TIMES_BOARD    "Updated <render time>" — freshness from the act of
 *                       drawing the screen.
 *   PARKING_AVAILABILITY "Updated 30s ago" — a string constant.
 *
 * That is the same defect the emergency system already bans (CLAUDE.md player
 * rule 10: copy states what the evidence proves). A lobby screen that says
 * nothing is honest; one that lights the wrong period, or tells a driver a
 * week-old space count is 30 seconds fresh, is not.
 *
 * HOW THESE MOUNT. Through `WidgetPreview` — the path BuilderZone and the
 * player's rendererBundle both use — because a test that calls the widget
 * function directly proves nothing about what reaches a screen (CLAUDE.md #9,
 * and the sibling `widget-truth` / `widget-hotspots` suites).
 *
 * HOW TIME IS PINNED. `jest.useFakeTimers().setSystemTime(...)`, and every
 * assertion that depends on a wall clock either configures an explicit IANA
 * zone (so the result cannot drift with the runner's TZ) or builds the instant
 * from LOCAL components, which is the device-clock contract itself.
 *
 * jsdom has no layout engine, so nothing here asserts on geometry — only on
 * text and state. `offsetHeight` is stubbed because the v2 pack renders
 * through `withMeasuredHeight`, which renders NOTHING while the measured
 * height is 0; without the stub every "does not say X" assertion below would
 * pass against an empty container, which is a false green, not a pass.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { WidgetPreview, warmVariantRegistry } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';
import '../variants-register';
import { parseTimeToMinutes } from '@/lib/format-time';
import {
  activeWindowIndex,
  configFreshness,
  freshnessLabel,
  nextWindowIndex,
  readClock,
  readRecordedTime,
} from '@/lib/time-truth';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

beforeAll(async () => {
  // See the header: without a non-zero offsetHeight, withMeasuredHeight
  // renders null and the v2 widgets below would assert against nothing.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return 480; },
  });
  // Families load from their own chunks; warm them before any fake timer is
  // installed so the dynamic imports settle on the real event loop.
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function at(instant: Date | string) {
  jest.useFakeTimers();
  jest.setSystemTime(typeof instant === 'string' ? new Date(instant) : instant);
}

function mount(widgetType: string, config: Record<string, unknown>) {
  return render(
    <div style={{ position: 'relative', width: 1200, height: 480 }}>
      <WidgetPreview widgetType={widgetType} config={config} width={100} height={100} />
    </div>,
  );
}

/** Text of the row that carries the NOW badge, or null when nothing claims to
 *  be the current period. Reads the DOM the operator sees, not widget state. */
function currentPeriodRow(): string | null {
  const badges = Array.from(document.querySelectorAll('span')).filter(
    (el) => el.textContent === 'NOW' && el.children.length === 0,
  );
  if (badges.length === 0) return null;
  return badges[0].parentElement?.textContent?.replace(/NOW$/, '') ?? null;
}

/**
 * An irregular day: first bell at 07:15, periods of uneven length, a
 * 95-minute hole between third period and lunch. Written the way
 * `BellScheduleEditor` actually saves — the raw HH:MM a native
 * `<input type="time">` emits, zero-padded.
 */
const IRREGULAR_DAY = [
  { label: 'Period 1', start: '07:15', end: '08:05' },
  { label: 'Period 2', start: '08:10', end: '09:00' },
  { label: 'Period 3', start: '09:05', end: '09:55' },
  { label: 'Lunch', start: '11:30', end: '12:10' },
  { label: 'Period 4', start: '12:15', end: '13:05' },
];

describe('W02 · BELL_SCHEDULE — "NOW" comes from the configured times, or not at all', () => {
  it('lights first period at 07:20 on a school whose day starts at 07:15', () => {
    // 12:20Z = 07:20 in Chicago (CDT) on a Tuesday.
    at('2026-09-15T12:20:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });

    expect(currentPeriodRow()).toContain('Period 1');
    // The old hour-index rule: floor(7 - 8) = -1, and the 08:00 gate was
    // closed, so at 07:20 it lit NOTHING — first period ran unmarked.
    expect(currentPeriodRow()).not.toContain('Period 2');
  });

  it('lights the period the clock is actually in, not the hour-index one', () => {
    // 14:30Z = 09:30 Chicago — inside Period 3 (09:05–09:55).
    at('2026-09-15T14:30:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });

    expect(currentPeriodRow()).toContain('Period 3');
    // The old rule at hour 9 picked index floor(9-8)=1 — "Period 2", which by
    // 09:30 had been over for half an hour.
    expect(currentPeriodRow()).not.toContain('Period 2');
  });

  it('claims NO current period inside the gap before lunch', () => {
    // 15:30Z = 10:30 Chicago. Period 3 ended at 09:55, Lunch starts at 11:30.
    at('2026-09-15T15:30:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });

    // The old rule lit index floor(10-8)=2 — "Period 3 · NOW" — through a
    // 95-minute hole when no class was in session.
    expect(currentPeriodRow()).toBeNull();
    // The schedule itself is still on the wall; only the false claim is gone.
    expect(screen.getByText('Period 3')).toBeInTheDocument();
  });

  it('claims NO current period on a Saturday, at a time that is mid-period on a weekday', () => {
    // 2026-09-19 is a Saturday. 14:30Z = 09:30 Chicago — inside Period 3 on
    // any school day, and inside the old rule's 08:00–15:00 gate too.
    at('2026-09-19T14:30:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });

    expect(currentPeriodRow()).toBeNull();
  });

  it('claims NO current period before the first bell or after the last', () => {
    at('2026-09-15T11:00:00Z'); // 06:00 Chicago — an hour before first bell.
    const early = mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });
    expect(currentPeriodRow()).toBeNull();
    early.unmount();

    at('2026-09-15T20:00:00Z'); // 15:00 Chicago — Period 4 ended at 13:05.
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });
    expect(currentPeriodRow()).toBeNull();
  });

  it('honours showCurrent:false — the operator can still turn the badge off', () => {
    at('2026-09-15T14:30:00Z');
    mount('BELL_SCHEDULE', {
      schedule: IRREGULAR_DAY, timezone: 'America/Chicago', showCurrent: false,
    });
    expect(currentPeriodRow()).toBeNull();
  });

  it('falls back to the DEVICE clock when no timezone is configured', () => {
    // Built from LOCAL components, so this holds whatever TZ the runner is in.
    // 2026-09-15 is a Tuesday; 09:30 local sits inside Period 3.
    at(new Date(2026, 8, 15, 9, 30, 0));
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY });
    expect(currentPeriodRow()).toContain('Period 3');
  });

  it('falls back to the device clock rather than throwing on a bad timezone', () => {
    at(new Date(2026, 8, 15, 9, 30, 0));
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'Mars/Olympus_Mons' });
    expect(currentPeriodRow()).toContain('Period 3');
  });

  it('DST: the same UTC minute is Period 2 before the change and Period 3 after', () => {
    // America/New_York goes EST → EDT on 2026-03-08. 13:20Z is 08:20 on the
    // Friday before (inside Period 2) and 09:20 on the Monday after (inside
    // Period 3). A fixed-offset implementation reports Period 2 both times.
    at('2026-03-06T13:20:00Z');
    const before = mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/New_York' });
    expect(currentPeriodRow()).toContain('Period 2');
    before.unmount();

    at('2026-03-09T13:20:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/New_York' });
    expect(currentPeriodRow()).toContain('Period 3');
  });

  it('a 07:15 first bell renders as 7:15am, not 7:15pm', () => {
    // `BellScheduleEditor` saves the picker's raw "07:15". The bare-hour PM
    // heuristic used to push that to 19:15, so the canvas printed the first
    // bell of the day as an evening time.
    at('2026-09-15T12:20:00Z');
    mount('BELL_SCHEDULE', { schedule: IRREGULAR_DAY, timezone: 'America/Chicago' });
    expect(screen.getByText('7:15am')).toBeInTheDocument();
    expect(screen.queryByText('7:15pm')).toBeNull();
  });
});

describe('W02 · LUNCH_MENU — "today" is the configured zone\'s today', () => {
  const WEEK = [
    'Monday: Pizza, Garden Salad',
    'Tuesday: Chicken Tacos, Spanish Rice',
    'Wednesday: Pasta Bar, Garlic Bread',
  ].join('\n');

  /** The weekday label of the highlighted row, or null when none is. The row's
   *  own textContent runs the day straight into the dishes ("TuesdayChicken
   *  Tacos…"), so match the known weekday rather than a leading-word regex. */
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function highlightedDay(): string | null {
    const rows = Array.from(document.querySelectorAll('div[style*="border-left"]')) as HTMLElement[];
    const lit = rows.find((el) => !el.style.borderLeft.includes('transparent'));
    const text = lit?.textContent ?? '';
    return DAYS.find((d) => text.startsWith(d)) ?? null;
  }

  it('highlights the row for the day it is in the board\'s own timezone', () => {
    // ONE instant, TWO boards. 03:00Z is still TUESDAY 22:00 in Chicago while
    // it is already WEDNESDAY noon in Tokyo. Asserting BOTH is what makes this
    // bite: a board reading the render machine's clock gives the same answer
    // for both mounts, so one of these fails on any runner timezone — whereas
    // a single assertion would pass by luck wherever the runner happens to
    // agree with the configured zone.
    at('2026-09-16T03:00:00Z');
    const chicago = mount('LUNCH_MENU', { menu: WEEK, timezone: 'America/Chicago' });
    expect(highlightedDay()).toBe('Tuesday');
    chicago.unmount();

    mount('LUNCH_MENU', { menu: WEEK, timezone: 'Asia/Tokyo' });
    expect(highlightedDay()).toBe('Wednesday');
  });

  it('highlights nothing when the day has no line at all', () => {
    at('2026-09-19T17:00:00Z'); // Saturday — not in the week above.
    mount('LUNCH_MENU', { menu: WEEK, timezone: 'America/Chicago' });
    expect(highlightedDay()).toBeNull();
  });
});

describe('W02 · ROOM_SCHEDULE — availability comes from the bookings, or is not claimed', () => {
  const ROOM = { variant: 'room-schedule', room: 'Pacific · 12-A', timezone: 'America/Chicago' };

  it('computes "Free for N min" from the next real booking', () => {
    // 19:00Z = 14:00 Chicago; the 2:30 PM booking is 30 minutes out.
    at('2026-09-15T19:00:00Z');
    mount('CORPORATE', {
      ...ROOM,
      status: 'AVAILABLE',
      events: [{ start: '2:30 PM', title: 'Q3 Planning', host: 'A. Chen', seats: 14 }],
    });

    expect(screen.getByText('Free for 30 min')).toBeInTheDocument();
    // The constant the sign used to print no matter what.
    expect(screen.queryByText('Free for 32 min')).toBeNull();
  });

  it('says "No bookings today" with an EMPTY booking list — never an invented window', () => {
    at('2026-09-15T19:00:00Z');
    mount('CORPORATE', { ...ROOM, status: 'AVAILABLE', events: [] });

    expect(screen.getByText('No bookings today')).toBeInTheDocument();
    expect(screen.queryByText(/Free for/)).toBeNull();
  });

  it('says "No bookings today" once every booking is in the past', () => {
    at('2026-09-16T01:00:00Z'); // 20:00 Chicago — long after a 2:30 PM meeting.
    mount('CORPORATE', {
      ...ROOM,
      status: 'AVAILABLE',
      events: [{ start: '2:30 PM', title: 'Q3 Planning', host: 'A. Chen', seats: 14 }],
    });

    expect(screen.getByText('No bookings today')).toBeInTheDocument();
  });

  it('BOOKED makes no time claim when no booking in progress carries an end', () => {
    at('2026-09-15T19:45:00Z'); // 14:45 Chicago — during the 2:30 PM meeting.
    mount('CORPORATE', {
      ...ROOM,
      status: 'BOOKED',
      events: [{ start: '2:30 PM', title: 'Q3 Planning', host: 'A. Chen', seats: 14 }],
    });

    // The status pill is the operator's own claim and survives.
    expect(screen.getByText('BOOKED')).toBeInTheDocument();
    // "Until 2:30 PM" was a constant, and it named the meeting's START.
    expect(screen.queryByText(/^Until /)).toBeNull();
  });

  it('BOOKED says "Until <end>" only for a booking that really is in progress', () => {
    at('2026-09-15T19:45:00Z'); // 14:45 Chicago.
    mount('CORPORATE', {
      ...ROOM,
      status: 'BOOKED',
      events: [{ start: '2:30 PM', end: '3:15 PM', title: 'Q3 Planning', host: 'A. Chen', seats: 14 }],
    });

    expect(screen.getByText('Until 3:15 PM')).toBeInTheDocument();
  });
});

describe('W02 · freshness — "Updated N ago" needs a recorded time', () => {
  const BOARD = {
    variant: 'wait-times-board',
    rows: [{ dept: 'Urgent Care', note: 'Walk-in', queued: 8, wait: 38 }],
  };

  it('WAIT_TIMES_BOARD says nothing at all when nothing recorded a time', () => {
    at('2026-09-15T19:00:00Z');
    mount('HEALTHCARE', BOARD);

    // The numbers are still shown — they are the operator's own.
    expect(screen.getByText('Urgent Care')).toBeInTheDocument();
    // But nothing claims they were just confirmed.
    expect(screen.queryByText(/Updated/)).toBeNull();
  });

  it('a feed fetched 3 HOURS ago does not say "just now"', () => {
    at('2026-09-15T19:00:00Z');
    mount('HEALTHCARE', { ...BOARD, updatedAt: '2026-09-15T16:00:00Z' });

    expect(screen.getByText('Updated 3h ago')).toBeInTheDocument();
    expect(screen.queryByText(/just now/)).toBeNull();
  });

  it('a NEW successful fetch moves the label back to "just now"', () => {
    at('2026-09-15T19:00:00Z');
    const stale = mount('HEALTHCARE', { ...BOARD, updatedAt: '2026-09-15T16:00:00Z' });
    expect(screen.getByText('Updated 3h ago')).toBeInTheDocument();
    stale.unmount();

    // The feed comes back and records the moment it succeeded.
    mount('HEALTHCARE', { ...BOARD, updatedAt: '2026-09-15T18:59:40Z' });
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    expect(screen.queryByText('Updated 3h ago')).toBeNull();
  });

  it('PARKING_AVAILABILITY no longer says "Updated 30s ago" off a constant', () => {
    at('2026-09-15T19:00:00Z');
    mount('LIVE_DATA', {
      variant: 'parking-availability',
      lots: [{ name: 'Daily Lot A', note: 'Long-term', total: 1200, avail: 47, rate: '$22/day' }],
    });

    expect(screen.getByText('Daily Lot A')).toBeInTheDocument();
    expect(screen.queryByText('Updated 30s ago')).toBeNull();
    expect(screen.queryByText(/Updated/)).toBeNull();
  });

  it('PARKING_AVAILABILITY dates its counts when the feed recorded a time', () => {
    at('2026-09-15T19:00:00Z');
    mount('LIVE_DATA', {
      variant: 'parking-availability',
      lots: [{ name: 'Daily Lot A', note: 'Long-term', total: 1200, avail: 47, rate: '$22/day' }],
      updatedAt: '2026-09-15T18:55:00Z',
    });

    expect(screen.getByText('Updated 5m ago')).toBeInTheDocument();
  });
});

/**
 * The arithmetic on its own. Mounted widgets prove the wiring; these prove the
 * edges — which are exactly where a time claim goes quietly wrong.
 */
describe('W02 · time-truth rules', () => {
  it('a window with no provable end can never be "now"', () => {
    // Last row has a start and nothing after it to inherit an end from.
    const open = [{ start: '08:00', end: '08:50' }, { start: '09:00' }];
    expect(activeWindowIndex(open, 8 * 60 + 30)).toBe(0);
    expect(activeWindowIndex(open, 9 * 60 + 30)).toBe(-1);
  });

  it('an omitted end is inherited from the next start', () => {
    const inherited = [{ start: '08:00' }, { start: '09:00' }, { start: '10:00', end: '10:50' }];
    expect(activeWindowIndex(inherited, 8 * 60 + 30)).toBe(0);
    expect(activeWindowIndex(inherited, 9 * 60 + 30)).toBe(1);
  });

  it('a window is half-open — the end minute already belongs to the next one', () => {
    const back2back = [{ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }];
    expect(activeWindowIndex(back2back, 8 * 60 + 59)).toBe(0);
    expect(activeWindowIndex(back2back, 9 * 60)).toBe(1);
  });

  it('an unparseable or backwards window is skipped, not guessed at', () => {
    expect(activeWindowIndex([{ start: 'lunchtime', end: 'later' }], 600)).toBe(-1);
    expect(activeWindowIndex([{ start: '10:00', end: '09:00' }], 9 * 60 + 30)).toBe(-1);
  });

  it('nextWindowIndex ignores a booking that already started', () => {
    const day = [{ start: '9:00 AM' }, { start: '2:30 PM' }, { start: '4:00 PM' }];
    expect(nextWindowIndex(day, 14 * 60)).toBe(1);
    expect(nextWindowIndex(day, 14 * 60 + 30)).toBe(2); // 2:30 is no longer ahead
    expect(nextWindowIndex(day, 17 * 60)).toBe(-1);
  });

  it('readClock returns the wall clock IN the configured zone', () => {
    const instant = new Date('2026-09-15T14:30:00Z'); // a Tuesday
    expect(readClock(instant, 'America/Chicago')).toEqual({ minutes: 9 * 60 + 30, weekday: 2 });
    expect(readClock(instant, 'UTC')).toEqual({ minutes: 14 * 60 + 30, weekday: 2 });
    expect(readClock(instant, 'Asia/Tokyo')).toEqual({ minutes: 23 * 60 + 30, weekday: 2 });
  });

  it('readClock carries the DAY across the date line, not just the hour', () => {
    // 16:30Z Tuesday is already 01:30 WEDNESDAY in Tokyo — and it is that
    // weekday, not the UTC one, that decides whether a bell schedule is
    // allowed to claim a period is in session.
    const instant = new Date('2026-09-15T16:30:00Z');
    expect(readClock(instant, 'Asia/Tokyo')).toEqual({ minutes: 60 + 30, weekday: 3 });
    // ...and westward, a Saturday-morning instant is still Friday in Honolulu.
    expect(readClock(new Date('2026-09-19T06:00:00Z'), 'Pacific/Honolulu'))
      .toEqual({ minutes: 20 * 60, weekday: 5 });
  });

  it('readClock reports midnight as minute 0, not 1440', () => {
    expect(readClock(new Date('2026-09-15T05:00:00Z'), 'America/Chicago').minutes).toBe(0);
  });

  it('a zero-padded hour is 24-hour notation, an unpadded 1-7 is the PM shorthand', () => {
    expect(parseTimeToMinutes('07:15')).toBe(7 * 60 + 15);
    expect(parseTimeToMinutes('01:05')).toBe(65);
    expect(parseTimeToMinutes('7:15')).toBe(19 * 60 + 15);  // shorthand, unchanged
    expect(parseTimeToMinutes('1')).toBe(13 * 60);          // shorthand, unchanged
    expect(parseTimeToMinutes('7:15 AM')).toBe(7 * 60 + 15);
    expect(parseTimeToMinutes('13:05')).toBe(13 * 60 + 5);
    expect(parseTimeToMinutes('08:00')).toBe(8 * 60);
  });

  it('freshness is null without a recorded time, and null for a FUTURE one', () => {
    const now = new Date('2026-09-15T19:00:00Z');
    expect(freshnessLabel(null, now)).toBeNull();
    expect(freshnessLabel(new Date('2026-09-15T23:00:00Z'), now)).toBeNull();
    expect(configFreshness({}, now)).toBeNull();
    expect(configFreshness({ updatedAt: '' }, now)).toBeNull();
    expect(configFreshness({ updatedAt: 'sometime yesterday' }, now)).toBeNull();
  });

  it('freshness counts up through every unit', () => {
    const now = new Date('2026-09-15T19:00:00Z');
    expect(freshnessLabel(new Date('2026-09-15T18:59:30Z'), now)).toBe('just now');
    expect(freshnessLabel(new Date('2026-09-15T18:47:00Z'), now)).toBe('13m ago');
    expect(freshnessLabel(new Date('2026-09-15T16:00:00Z'), now)).toBe('3h ago');
    expect(freshnessLabel(new Date('2026-09-13T19:00:00Z'), now)).toBe('2d ago');
  });

  it('readRecordedTime accepts ISO, epoch ms and Date — and nothing else', () => {
    expect(readRecordedTime('2026-09-15T19:00:00Z')?.toISOString()).toBe('2026-09-15T19:00:00.000Z');
    expect(readRecordedTime(1_789_506_000_000)?.getTime()).toBe(1_789_506_000_000);
    expect(readRecordedTime(new Date(0))?.getTime()).toBe(0);
    expect(readRecordedTime(undefined)).toBeNull();
    expect(readRecordedTime('')).toBeNull();
    expect(readRecordedTime('not a date')).toBeNull();
    expect(readRecordedTime(Number.NaN)).toBeNull();
    expect(readRecordedTime(new Date('nope'))).toBeNull();
  });

  it('configFreshness reads the legacy lastUpdated alias too', () => {
    const now = new Date('2026-09-15T19:00:00Z');
    expect(configFreshness({ lastUpdated: '2026-09-15T16:00:00Z' }, now)).toBe('3h ago');
  });
});
