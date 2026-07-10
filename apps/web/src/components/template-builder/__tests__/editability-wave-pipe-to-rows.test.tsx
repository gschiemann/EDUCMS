/**
 * §19 editability fix-wave proof (2026-05-28, Opus 4.8).
 *
 * Runnable RTL proof — NOT a static trace — that the five remaining
 * pipe/line textarea editors are now per-row editors and that LOGO
 * wordmark text gained font/color controls.
 *
 * Two kinds of test here:
 *   1. Sub-component tests (STATS / HONOR_ROLL / CALENDAR via
 *      <ListItemsEditor>; BIRTHDAYS via <StringListEditor>) driven with
 *      the EXACT field schemas wired into PropertiesPanel.ContentFields,
 *      proving an edit flows back through onChange in the shape the
 *      matching widget reads (confirmed against GenericWidgets.tsx /
 *      WidgetRenderer.tsx).
 *   2. End-to-end tests that mount the REAL <ContentFields> switch with a
 *      `zone` + `updateZone` (exactly what PropertiesPanel passes it), so
 *      we exercise the actual render path:
 *        - SCHEDULE_GRID → <ScheduleRowsField> (proves the conversion is
 *          wired, not just that the component exists).
 *        - LOGO → proves the universal Font + Text-color controls now
 *          render (LOGO removed from MEDIA_ONLY) AND fire a config write.
 *
 * If any of these break, the conversion is not "done".
 */
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ListItemsEditor,
  StringListEditor,
  ScheduleRowsField,
  ContentFields,
} from '../PropertiesPanel';
import type { ListItemFieldSpec } from '../PropertiesPanel';

// Test-noise silencer: the builder UI mounts the AI affordances
// (AiGenerateButton / ChatToEditBox / InlineRewriteChips / …), each of
// which probes GET /ai/key through apiFetch() on mount. In jsdom that
// probe can only fail — spamming console.error from the api-client
// logger — and its .then(setState) lands AFTER the test's act() scope,
// firing "not wrapped in act(...)" warnings. This suite does not test
// the AI affordances, so keep the probe permanently pending.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

/** Pull the most recent value handed to an onChange spy. */
function lastCall<T>(fn: jest.Mock, argIdx = 0): T {
  const calls = fn.mock.calls;
  return calls[calls.length - 1][argIdx] as T;
}

// ─── Field schemas mirrored 1:1 from ContentFields ──────────────────────────
// STATS — cfg.stats: { value, label }[]  (StatsWidget reads value/label)
const STATS_FIELDS: ListItemFieldSpec[] = [
  { key: 'value', label: 'Big number', type: 'text' },
  { key: 'label', label: 'Label', type: 'text' },
];
// HONOR_ROLL — cfg.students: { name, reason }[]  (HonorRollWidget)
const STUDENT_FIELDS: ListItemFieldSpec[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'reason', label: 'Reason', type: 'text' },
];
// CALENDAR — cfg.events: { date, title, time?, location?, tag?, color? }[]
const EVENT_FIELDS: ListItemFieldSpec[] = [
  { key: 'date', label: 'Date', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'time', label: 'Time', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'tag', label: 'Tag', type: 'text' },
  { key: 'color', label: 'Dot color', type: 'color' },
];

describe('STATS — value/label cards (was a pipe textarea)', () => {
  const stats = [
    { value: '97%', label: 'Attendance' },
    { value: '4.2', label: 'Avg GPA' },
  ];

  it('renders an input per field with the real values', () => {
    render(<ListItemsEditor label="Stats" itemNoun="stat" value={stats} onChange={jest.fn()} fields={STATS_FIELDS} />);
    expect(screen.getByDisplayValue('97%')).toBeTruthy();
    expect(screen.getByDisplayValue('Attendance')).toBeTruthy();
    expect(screen.getByDisplayValue('4.2')).toBeTruthy();
  });

  it('editing the big number flows back as { value, label }[] — sibling untouched', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Stats" itemNoun="stat" value={stats} onChange={onChange} fields={STATS_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('97%'), { target: { value: '99%' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].value).toBe('99%');
    expect(next[0].label).toBe('Attendance'); // sibling field untouched
    expect(next[1].value).toBe('4.2'); // other row untouched
  });

  it('accepts a legacy JSON-string value without blanking (back-compat)', () => {
    render(<ListItemsEditor label="Stats" itemNoun="stat" value={JSON.stringify(stats)} onChange={jest.fn()} fields={STATS_FIELDS} />);
    expect(screen.getByDisplayValue('97%')).toBeTruthy();
  });

  it('Add appends a blank stat', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Stats" itemNoun="stat" value={stats} onChange={onChange} fields={STATS_FIELDS} newItem={{ value: '', label: '' }} />);
    fireEvent.click(screen.getByRole('button', { name: /add stat/i }));
    expect(lastCall<Record<string, unknown>[]>(onChange)).toHaveLength(3);
  });
});

describe('HONOR_ROLL — name/reason rows (was a pipe textarea)', () => {
  const students = [
    { name: 'Jordan Lee', reason: 'Perfect attendance' },
    { name: 'Maria Santos', reason: 'Kindness award' },
  ];

  it('editing a reason flows back as { name, reason }[]', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Students" itemNoun="student" value={students} onChange={onChange} fields={STUDENT_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('Kindness award'), { target: { value: 'Science fair winner' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[1].reason).toBe('Science fair winner');
    expect(next[1].name).toBe('Maria Santos'); // sibling untouched
    expect(next[0].name).toBe('Jordan Lee'); // other row untouched
  });

  it('Remove deletes the right student', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Students" itemNoun="student" value={students} onChange={onChange} fields={STUDENT_FIELDS} />);
    fireEvent.click(screen.getByRole('button', { name: /remove student 1/i }));
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Maria Santos');
  });
});

describe('CALENDAR — per-event rows with date/time/location/tag/color (was a pipe textarea)', () => {
  const events = [
    { date: 'TUE 04', title: 'Spring Concert', time: '7:00 PM', location: 'Auditorium', tag: 'ARTS' },
    { date: 'WED 05', title: 'Robotics Meet', time: '3:30 PM', location: 'STEM Lab', tag: 'CLUB' },
  ];

  it('renders date + title + the extended fields per event', () => {
    render(<ListItemsEditor label="Events" itemNoun="event" value={events} onChange={jest.fn()} fields={EVENT_FIELDS} />);
    expect(screen.getByDisplayValue('Spring Concert')).toBeTruthy();
    expect(screen.getByDisplayValue('Auditorium')).toBeTruthy();
    expect(screen.getByDisplayValue('CLUB')).toBeTruthy();
  });

  it('editing the location flows back, keeping date/title/tag on the row', () => {
    const onChange = jest.fn();
    render(<ListItemsEditor label="Events" itemNoun="event" value={events} onChange={onChange} fields={EVENT_FIELDS} />);
    fireEvent.change(screen.getByDisplayValue('Auditorium'), { target: { value: 'Main Gym' } });
    const next = lastCall<Record<string, unknown>[]>(onChange);
    expect(next[0].location).toBe('Main Gym');
    expect(next[0].date).toBe('TUE 04'); // required field preserved
    expect(next[0].title).toBe('Spring Concert');
    expect(next[0].tag).toBe('ARTS');
  });

  it('exposes a per-event color control (the pipe editor had none)', () => {
    // color field => a ColorPickerField button labelled "... Dot color"
    render(<ListItemsEditor label="Events" itemNoun="event" value={events} onChange={jest.fn()} fields={EVENT_FIELDS} />);
    expect(screen.getAllByRole('button', { name: /Dot color/i }).length).toBeGreaterThan(0);
  });
});

describe('BIRTHDAYS — one input per name (was a line textarea)', () => {
  const names = ['Morgan P.', 'Samir K.', 'Ava L.'];

  it('renders one input per name', () => {
    render(<StringListEditor label="Names" itemNoun="name" value={names} onChange={jest.fn()} />);
    expect(screen.getByDisplayValue('Morgan P.')).toBeTruthy();
    expect(screen.getByDisplayValue('Samir K.')).toBeTruthy();
    expect(screen.getByDisplayValue('Ava L.')).toBeTruthy();
  });

  it('editing a name flows back as a plain string[] (not object-wrapped)', () => {
    const onChange = jest.fn();
    render(<StringListEditor label="Names" itemNoun="name" value={names} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Samir K.'), { target: { value: 'Samir Khan' } });
    const next = lastCall<string[]>(onChange);
    expect(next).toEqual(['Morgan P.', 'Samir Khan', 'Ava L.']);
    expect(typeof next[1]).toBe('string');
  });

  it('accepts a legacy JSON-string value without blanking', () => {
    render(<StringListEditor label="Names" itemNoun="name" value={JSON.stringify(names)} onChange={jest.fn()} />);
    expect(screen.getByDisplayValue('Morgan P.')).toBeTruthy();
  });
});

describe('SCHEDULE_GRID — ScheduleRowsField (was a pipe textarea)', () => {
  // The widget reads cfg.periods: { num, name, time }[]; ScheduleRowsField
  // exposes time + name (+ optional room) and auto-renumbers `num`.
  const periods = [
    { num: '1', name: 'Homeroom', time: '8:00 - 8:15' },
    { num: '2', name: 'English', time: '8:20 - 9:15' },
  ];

  it('loads a legacy {num,name,time}[] array into editable inputs', () => {
    render(<ScheduleRowsField label="Periods" value={periods} onChange={jest.fn()} />);
    expect(screen.getByDisplayValue('Homeroom')).toBeTruthy();
    expect(screen.getByDisplayValue('8:00 - 8:15')).toBeTruthy();
    expect(screen.getByDisplayValue('English')).toBeTruthy();
  });

  it('editing the class name flows back, num auto-renumbered to a stable 1..N', () => {
    const onChange = jest.fn();
    render(<ScheduleRowsField label="Periods" value={periods} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('English'), { target: { value: 'Algebra' } });
    const next = lastCall<Array<Record<string, unknown>>>(onChange);
    expect(next[1].name).toBe('Algebra');
    expect(next[1].time).toBe('8:20 - 9:15'); // sibling field preserved
    expect(next[0].num).toBe(1);
    expect(next[1].num).toBe(2);
  });
});

// ─── End-to-end: drive the REAL ContentFields switch ────────────────────────
// Builds a zone the way the store holds one and asserts updateZone gets the
// right { defaultConfig } patch — proving the case is actually WIRED, not that
// a standalone component happens to work.
function makeZone(widgetType: string, defaultConfig: Record<string, unknown> = {}) {
  return { id: 'zone-test-1', widgetType, defaultConfig };
}

describe('ContentFields[SCHEDULE_GRID] — wired end-to-end', () => {
  it('renders ScheduleRowsField inputs and writes cfg.periods through updateZone', () => {
    const updateZone = jest.fn();
    const zone = makeZone('SCHEDULE_GRID', { periods: [{ num: '1', name: 'Homeroom', time: '8:00 - 8:15' }] });
    render(<ContentFields zone={zone} updateZone={updateZone} />);
    // The schedule editor input carries the class name.
    const nameInput = screen.getByDisplayValue('Homeroom');
    fireEvent.change(nameInput, { target: { value: 'Advisory' } });
    expect(updateZone).toHaveBeenCalled();
    // updateZone(id, patch, commit) — patch.defaultConfig.periods is the new array.
    const [id, patch] = updateZone.mock.calls[updateZone.mock.calls.length - 1];
    expect(id).toBe('zone-test-1');
    const periods = (patch.defaultConfig as Record<string, unknown>).periods as Array<Record<string, unknown>>;
    expect(periods[0].name).toBe('Advisory');
    expect(periods[0].time).toBe('8:00 - 8:15'); // preserved
  });
});

describe('ContentFields[LOGO] — wordmark font/color now editable (removed from MEDIA_ONLY)', () => {
  it('exposes the universal Font select for LOGO and writes cfg.fontFamily', () => {
    const updateZone = jest.fn();
    const zone = makeZone('LOGO', { schoolName: 'Sunnyside Elementary', initials: 'SE' });
    render(<ContentFields zone={zone} updateZone={updateZone} />);

    // The LOGO case itself adds NO font control, so any "Font" select here is
    // the universal text-style block — proof LOGO is no longer skipped.
    const fontLabel = screen.getByText('Font');
    const fontSelect = fontLabel.parentElement?.querySelector('select') as HTMLSelectElement;
    expect(fontSelect).toBeTruthy();

    // Pick the first non-empty font option and confirm it writes fontFamily.
    const opt = Array.from(fontSelect.options).find((o) => o.value && o.value.trim());
    expect(opt).toBeTruthy();
    fireEvent.change(fontSelect, { target: { value: opt!.value } });
    expect(updateZone).toHaveBeenCalled();
    const [, patch] = updateZone.mock.calls[updateZone.mock.calls.length - 1];
    expect((patch.defaultConfig as Record<string, unknown>).fontFamily).toBe(opt!.value);
  });

  it('exposes a "Text color" control for LOGO and firing it writes cfg.color', () => {
    const updateZone = jest.fn();
    const zone = makeZone('LOGO', { schoolName: 'Sunnyside Elementary' });
    render(<ContentFields zone={zone} updateZone={updateZone} />);

    // Universal block's ColorField renders a button with aria-label "Text color".
    const colorBtn = screen.getByRole('button', { name: 'Text color' });
    expect(colorBtn).toBeTruthy();
    fireEvent.click(colorBtn); // open the popover (portal)

    // The popover has a "Standard colors" grid; clicking a swatch jumps the
    // HSV state to that color, whose effect emits onChange → setField({ color })
    // → updateZone with the chosen hex. Target a specific swatch (#ef4444) so
    // the query is unambiguous.
    const swatch = screen.getByRole('button', { name: 'Set color to #ef4444' });
    fireEvent.click(swatch);
    expect(updateZone).toHaveBeenCalled();
    const colorWrites = updateZone.mock.calls
      .map((c) => (c[1].defaultConfig as Record<string, unknown>).color)
      .filter((v) => typeof v === 'string' && (v as string).startsWith('#'));
    expect(colorWrites.length).toBeGreaterThan(0);
    expect(colorWrites[colorWrites.length - 1]).toBe('#ef4444');
  });

  it('still renders the LOGO image picker (Browse library) — picker not broken by the MEDIA_ONLY change', () => {
    const updateZone = jest.fn();
    const zone = makeZone('LOGO', {});
    render(<ContentFields zone={zone} updateZone={updateZone} />);
    expect(screen.getByRole('button', { name: /browse library/i })).toBeTruthy();
  });
});
