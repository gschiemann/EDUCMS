/**
 * STRUCTURED ROWS MUST SURVIVE THE EDITOR.
 *
 * ── THE BUG (2026-09-11, audit finding W01) ───────────────────────────
 * The v2 fallback editor derived its controls from the registry default and
 * treated EVERY array the same way: render `cur.join(', ')` into a TextField,
 * save `v.split(',')`. For a list of primitives that is correct. For a list of
 * OBJECTS — `WAIT_TIMES_BOARD.rows: [{dept, wait, …}]`, `ROOM_SCHEDULE.upNext:
 * [{start, title, …}]` — it rendered "[object Object], [object Object]" and
 * saved that string array back over the operator's data.
 *
 * The row was not mangled by a wrong keystroke; it was destroyed by opening the
 * panel and touching the field. Same class as the LUNCH_MENU dotted-key
 * corruption fixed the same day: a control that looks like it is editing your
 * content while writing something the renderer can never read.
 *
 * These tests assert the SHAPE survives, because that is what was lost.
 *
 * TWO LAYERS, ON PURPOSE. The helper tests pin the DECISION
 * (object-vs-primitive); the ContentFields tests at the bottom pin the WIRING,
 * by mounting the real editor for a real registry widget. Only the second layer
 * can fail if someone deletes the branch — MUTATION-CHECKED: with the branch
 * disabled (`false && …`) the three end-to-end tests go red and all thirteen
 * helper tests stay green. A suite that cannot fail on the code path that
 * matters is decoration, and this one says out loud which half is which.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ContentFields,
  isRowArray,
  rowFieldsFromSample,
  blankRowFromSample,
} from '../PropertiesPanel';

// Test-noise silencer (same reason as editability-wave-pipe-to-rows.test.tsx):
// the builder's AI affordances probe GET /ai/key on mount, which in jsdom can
// only fail — and resolve after the test's act() scope. Keep it pending.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

// The two registry defaults the audit named, copied verbatim in shape.
const WAIT_ROWS = [
  { dept: 'Emergency · Triage', wait: 35, status: 'busy' },
  { dept: 'Imaging', wait: 10, status: 'ok' },
];
const ROOM_UPNEXT = [
  { start: '10:00', title: 'Design review', owner: 'Ana' },
];

describe('isRowArray — object lists get a repeater, primitive lists do not', () => {
  it('is true for a list of objects', () => {
    expect(isRowArray(WAIT_ROWS)).toBe(true);
    expect(isRowArray(ROOM_UPNEXT)).toBe(true);
  });

  it('is false for a list of primitives — a comma field is right for those', () => {
    expect(isRowArray(['Welcome back', 'Picture day Friday'])).toBe(false);
    expect(isRowArray([1, 2, 3])).toBe(false);
  });

  it('is false for an empty array — it carries no schema to derive from', () => {
    expect(isRowArray([])).toBe(false);
  });

  it('is false for a list of arrays — not a row shape', () => {
    expect(isRowArray([['a', 'b']])).toBe(false);
  });

  it('is false for a list whose first element is null', () => {
    expect(isRowArray([null as unknown as object])).toBe(false);
  });
});

describe('rowFieldsFromSample — every key on the row becomes a control', () => {
  it('derives one field per key, so no property is silently dropped on save', () => {
    const spec = rowFieldsFromSample(WAIT_ROWS[0]);
    expect(spec.map((f) => f.key)).toEqual(['dept', 'wait', 'status']);
  });

  it('types a numeric column as a number, not text', () => {
    const spec = rowFieldsFromSample(WAIT_ROWS[0]);
    expect(spec.find((f) => f.key === 'wait')?.type).toBe('number');
    expect(spec.find((f) => f.key === 'dept')?.type).toBe('text');
  });

  it('gives long copy a textarea', () => {
    const spec = rowFieldsFromSample({ blurb: 'x'.repeat(60) });
    expect(spec[0].type).toBe('textarea');
  });

  it('labels a key readably rather than showing the raw key', () => {
    const spec = rowFieldsFromSample(ROOM_UPNEXT[0]);
    expect(spec.find((f) => f.key === 'start')?.label).toBeTruthy();
    expect(spec.find((f) => f.key === 'start')?.label).not.toBe('start');
  });
});

describe('blankRowFromSample — a new row is an OBJECT with the same keys', () => {
  it('keeps every key so an unfilled row still round-trips as an object', () => {
    expect(Object.keys(blankRowFromSample(WAIT_ROWS[0]))).toEqual(['dept', 'wait', 'status']);
  });

  it('types the blanks so a number column does not become an empty string', () => {
    const blank = blankRowFromSample(WAIT_ROWS[0]);
    expect(blank.wait).toBe(0);
    expect(blank.dept).toBe('');
  });

  it('is a fresh object each call — a shared row would alias every added row', () => {
    const a = blankRowFromSample(WAIT_ROWS[0]);
    const b = blankRowFromSample(WAIT_ROWS[0]);
    expect(a).not.toBe(b);
  });
});

describe('the regression itself, stated plainly', () => {
  it('the OLD round trip destroyed the rows; the new branch never runs it', () => {
    // Exactly what the editor used to do to `rows`.
    const destroyed = WAIT_ROWS.join(', ').split(',').map((s) => s.trim()).filter(Boolean);
    expect(destroyed).toEqual(['[object Object]', '[object Object]']);
    expect(destroyed[0]).not.toEqual(WAIT_ROWS[0]);

    // And the guard that now keeps that path away from object arrays.
    expect(isRowArray(WAIT_ROWS)).toBe(true);
  });
});

// ─── End-to-end: drive the REAL ContentFields switch ────────────────────────
// The helper tests above prove the DECISION is right. They cannot prove it is
// WIRED — delete the branch from the render and every one of them still passes.
// So mount the real editor for a real registry widget and look at what the
// operator would see and what a save would write.
describe('ContentFields[v2 fallback] — a row array is a repeater, not a comma field', () => {
  // WAIT_TIMES_BOARD (`v2/registry.ts`): defaults.rows = [{dept, note, queued, wait}].
  // Variant ids are the type lower-kebab'd — see V2_BY_VARIANT_ID.
  const zone = () => ({
    id: 'zone-w01',
    widgetType: 'WAIT_TIMES_BOARD',
    defaultConfig: { variant: 'wait-times-board' },
  });

  it('never renders "[object Object]" — the visible half of the bug', () => {
    render(<ContentFields zone={zone()} updateZone={jest.fn()} />);
    for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
      expect((el as HTMLInputElement).value).not.toContain('[object Object]');
    }
  });

  it('renders a control per row property, seeded from the registry default', () => {
    render(<ContentFields zone={zone()} updateZone={jest.fn()} />);
    expect(screen.getByDisplayValue('Emergency · Triage')).toBeTruthy();
    expect(screen.getByDisplayValue('Urgent Care')).toBeTruthy();
  });

  it('an edit saves OBJECTS back, with the untouched keys intact', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={zone()} updateZone={updateZone} />);
    fireEvent.change(screen.getByDisplayValue('Urgent Care'), { target: { value: 'Urgent Care · West' } });

    expect(updateZone).toHaveBeenCalled();
    const [id, patch] = updateZone.mock.calls[updateZone.mock.calls.length - 1];
    expect(id).toBe('zone-w01');
    const rows = (patch.defaultConfig as Record<string, unknown>).rows as Array<Record<string, unknown>>;

    // The shape survives — this is the whole finding.
    expect(Array.isArray(rows)).toBe(true);
    expect(typeof rows[1]).toBe('object');
    expect(rows[1].dept).toBe('Urgent Care · West');
    // …and the properties the operator did not touch came along.
    expect(rows[1].note).toBe('Level 4-5 conditions');
    expect(rows[1].wait).toBe(38);
    // The old behaviour, stated as a guard: nothing stringified.
    expect(rows.some((r) => typeof r === 'string')).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('[object Object]');
  });
});
