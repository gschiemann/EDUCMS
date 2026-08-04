/**
 * §19 launch-blocker proof (2026-08-03) — the 70 v2 widget variants that could
 * not be styled AT ALL.
 *
 * The bug: `ContentFields` is a `switch (zone.widgetType)`. The v2 Style
 * section (colours / type / background) lived inside the `default:` case, so it
 * only ever rendered for v2 widgets whose canonical type has NO hand-built
 * case. Every v2 variant registered under CLOCK / ANNOUNCEMENT / CALENDAR /
 * STAFF_SPOTLIGHT / COUNTDOWN / LOGO / WEATHER / BELL_SCHEDULE (the eight EDU
 * packs — 40 variants) `break`s out of the switch long before `default:`. And
 * the universal "Text style" fallback explicitly skipped v2 widgets on the
 * premise that their own Style section covered it. Both hatches shut ⇒ the
 * operator could retype the words and change nothing else. §19: "anything
 * below a B is a launch blocker"; this was an F.
 *
 * These tests mount the REAL `ContentFields` — the same component
 * `PropertiesPanel` dispatches — per CLAUDE.md rule #9 (green CI is not proof a
 * file is mounted; drive the actual surface).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ContentFields } from '../PropertiesPanel';

// Same probe-silencer the other §19 suites use: the builder mounts AI
// affordances that hit GET /ai/key on mount; in jsdom that can only fail and
// its .then(setState) lands after act(). Keep the probe pending forever.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

function makeZone(widgetType: string, defaultConfig: Record<string, unknown> = {}) {
  return { id: 'v2-zone', widgetType, defaultConfig };
}

/** Last { defaultConfig } patch handed to updateZone. */
function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig as Record<string, unknown>;
}

/** SelectField renders a bare <label> (no htmlFor), so find it by text and
 *  walk to the sibling <select>. */
function selectFor(label: string): HTMLSelectElement {
  const lbl = screen.getByText(label);
  const sel = lbl.parentElement?.querySelector('select');
  if (!sel) throw new Error(`no <select> next to label "${label}"`);
  return sel as HTMLSelectElement;
}

/**
 * One representative variant per EDU pack, paired with the canonical widget
 * type `variants-register.ts` registers it under — i.e. exactly the eight
 * hand-built cases that used to swallow the Style section.
 */
const PACKS: Array<[label: string, widgetType: string, variant: string]> = [
  ['Announcements', 'ANNOUNCEMENT', 'ann-neon'],
  ['Calendars', 'CALENDAR', 'cal-neon'],
  ['Staff', 'STAFF_SPOTLIGHT', 'staff-neon'],
  ['Countdowns', 'COUNTDOWN', 'cd-neon'],
  ['Logos', 'LOGO', 'logo-neon'],
  ['Weather', 'WEATHER', 'wx-neon'],
  ['Bell Schedules', 'BELL_SCHEDULE', 'bell-neon'],
  ['Clocks', 'CLOCK', 'clock-neon'],
];

describe('§19 — every v2 variant on a hand-built case gets the Style section', () => {
  it.each(PACKS)(
    '%s (%s / variant=%s) surfaces colours, type and background',
    (_pack, widgetType, variant) => {
      render(
        <ContentFields zone={makeZone(widgetType, { variant })} updateZone={jest.fn()} />,
      );
      // Colours — ColorPickerField puts the label on the trigger button.
      expect(screen.getByLabelText('Background color')).toBeTruthy();
      expect(screen.getByLabelText('Text color')).toBeTruthy();
      expect(screen.getByLabelText('Accent color')).toBeTruthy();
      expect(screen.getByLabelText('Highlight / glow')).toBeTruthy();
      // Type.
      expect(selectFor('Font')).toBeTruthy();
      expect(selectFor('Font weight')).toBeTruthy();
      expect(selectFor('Text alignment')).toBeTruthy();
      // Background.
      expect(selectFor('Gradient wash')).toBeTruthy();
    },
  );

  it.each(PACKS)(
    '%s (%s) also gets font SIZE and B/I/U/S from the universal block',
    (_pack, widgetType, variant) => {
      render(
        <ContentFields zone={makeZone(widgetType, { variant })} updateZone={jest.fn()} />,
      );
      // Font size — the control the v2 `config.style` system has no honest
      // equivalent for (widgets hard-code their own sizes; the zone-wide
      // !important injection is what actually moves them).
      expect(screen.getByLabelText('Font size')).toBeTruthy();
      expect(screen.getByRole('button', { name: /bold/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /italic/i })).toBeTruthy();
    },
  );
});

describe('§19 — the controls write the keys the widgets actually read', () => {
  it('Font writes config.style.fontFamily (resolveStyle → frameStyle reads it)', () => {
    const updateZone = jest.fn();
    render(
      <ContentFields
        zone={makeZone('CLOCK', { variant: 'clock-neon' })}
        updateZone={updateZone}
      />,
    );
    const sel = selectFor('Font');
    const option = Array.from(sel.options).find((o) => o.value.includes('Georgia'));
    expect(option).toBeTruthy();
    fireEvent.change(sel, { target: { value: option!.value } });
    const style = lastCfg(updateZone).style as Record<string, unknown>;
    expect(style.fontFamily).toContain('Georgia');
  });

  it('Text alignment writes config.style.textAlign', () => {
    const updateZone = jest.fn();
    render(
      <ContentFields
        zone={makeZone('LOGO', { variant: 'logo-neon' })}
        updateZone={updateZone}
      />,
    );
    fireEvent.change(selectFor('Text alignment'), { target: { value: 'center' } });
    const style = lastCfg(updateZone).style as Record<string, unknown>;
    expect(style.textAlign).toBe('center');
  });

  it('clearing a style key DELETES it so the widget falls back to its design', () => {
    const updateZone = jest.fn();
    render(
      <ContentFields
        zone={makeZone('WEATHER', { variant: 'wx-neon', style: { fontFamily: 'Georgia, serif' } })}
        updateZone={updateZone}
      />,
    );
    fireEvent.change(selectFor('Font'), { target: { value: '' } });
    const style = lastCfg(updateZone).style as Record<string, unknown>;
    expect('fontFamily' in style).toBe(false);
  });

  it('Font size writes the zone-wide cfg.fontSize the CSS injection consumes', () => {
    const updateZone = jest.fn();
    render(
      <ContentFields
        zone={makeZone('ANNOUNCEMENT', { variant: 'ann-neon' })}
        updateZone={updateZone}
      />,
    );
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '96' } });
    expect(lastCfg(updateZone).fontSize).toBe(96);
  });
});

describe('§19 — no duplicate/competing controls, and no regression off the v2 path', () => {
  it('a v2 variant shows exactly ONE Font picker and ONE Text color control', () => {
    render(
      <ContentFields
        zone={makeZone('ANNOUNCEMENT', { variant: 'ann-neon' })}
        updateZone={jest.fn()}
      />,
    );
    // The universal block deliberately does NOT repeat font-family/text-colour
    // for v2 — `config.style` owns those natively.
    expect(screen.getAllByText('Font')).toHaveLength(1);
    expect(screen.getAllByLabelText('Text color')).toHaveLength(1);
  });

  it('a NON-v2 widget still gets the universal Font + Text color (unchanged)', () => {
    render(<ContentFields zone={makeZone('ANNOUNCEMENT', { message: 'Hi' })} updateZone={jest.fn()} />);
    expect(screen.getByLabelText('Font size')).toBeTruthy();
    expect(screen.getByLabelText('Text color')).toBeTruthy();
    // …and NOT the v2-only controls, since there is no variant.
    expect(screen.queryByText('Gradient wash')).toBeNull();
    expect(screen.queryByLabelText('Highlight / glow')).toBeNull();
  });

  it('a v2 variant that already reached default: (celebration) still has its Style section', () => {
    // Regression guard for the hoist itself — these used to be the ONLY v2
    // widgets with a Style section, and must not have lost it.
    render(
      <ContentFields
        zone={makeZone('CELEBRATION', { variant: 'cel-football-touchdown' })}
        updateZone={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Background color')).toBeTruthy();
    expect(selectFor('Gradient wash')).toBeTruthy();
  });

  it('the hand-built CONTENT fields survive alongside the Style section', () => {
    // The two compose: the case owns content, the hoisted block owns style.
    render(
      <ContentFields
        zone={makeZone('STAFF_SPOTLIGHT', { variant: 'staff-neon' })}
        updateZone={jest.fn()}
      />,
    );
    // Hand-built STAFF_SPOTLIGHT content fields…
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Role')).toBeTruthy();
    expect(screen.getByText('Bio')).toBeTruthy();
    // …plus the hoisted Style section.
    expect(screen.getByLabelText('Background color')).toBeTruthy();
  });
});
