/**
 * Templates Gallery — Calm v1 · usage truth rules.
 *
 * §18's acceptance list contains one line that is a product-safety rule
 * rather than a design preference: "No unverified LIVE or screen-reach
 * claim is displayed." This suite is that line, executable.
 *
 * The failure it guards against is specific and asymmetric. A gallery
 * that says nothing costs an operator a click. A gallery that says
 * "Not in use" about a board running on three lobby screens costs them a
 * deletion they would never have made — and the cheapest way to
 * introduce that bug is a well-meaning `?? {}` on a failed request.
 */

import {
  deriveTemplateUsage,
  usagePillLabel,
  usageReachLabel,
  templateNeedsAttention,
  canvasBadgeLabel,
  lastEditedLabel,
} from '../template-usage';

describe('deriveTemplateUsage — unknown is never zero', () => {
  it('an unavailable summary is UNKNOWN, not idle', () => {
    // The single most important assertion in this file: this is what the
    // endpoint being undeployed / 500ing / timing out looks like.
    expect(deriveTemplateUsage(undefined, 'tpl-1')).toEqual({ kind: 'unknown' });
  });

  it('renders NOTHING for unknown — no pill, no reach line', () => {
    const state = deriveTemplateUsage(undefined, 'tpl-1');
    expect(usagePillLabel(state)).toBeNull();
    expect(usageReachLabel(state)).toBeNull();
  });

  it('a present-but-malformed row is unknown, not zero', () => {
    // A server that answers with a partial row must not be read as
    // "nothing uses this" — the numbers simply aren't there.
    const map = { 'tpl-1': { activeNow: true } as any };
    expect(deriveTemplateUsage(map, 'tpl-1')).toEqual({ kind: 'unknown' });
  });

  it('absent from a KNOWN summary IS a real answer (idle)', () => {
    // Distinct from the case above: the server enumerated usage and this
    // template carried no rows, so "Not in use" is proven, not assumed.
    expect(deriveTemplateUsage({}, 'tpl-1')).toEqual({ kind: 'idle' });
    expect(usagePillLabel(deriveTemplateUsage({}, 'tpl-1'))).toBe('Not in use');
  });
});

describe('deriveTemplateUsage — LIVE needs proof', () => {
  it('claims LIVE only when activeNow AND screensReached > 0', () => {
    const state = deriveTemplateUsage(
      { 'tpl-1': { playlists: 2, screensReached: 3, activeNow: true } },
      'tpl-1',
    );
    expect(state).toEqual({ kind: 'live', screens: 3, playlists: 2 });
    expect(usagePillLabel(state)).toBe('LIVE · 3 screens');
    expect(usageReachLabel(state)).toBe('Used by 2 playlists');
  });

  it('activeNow with ZERO reach is not proof — never says LIVE', () => {
    const state = deriveTemplateUsage(
      { 'tpl-1': { playlists: 1, screensReached: 0, activeNow: true } },
      'tpl-1',
    );
    expect(state.kind).toBe('in-playlists');
    expect(usagePillLabel(state)).toBeNull();
    expect(usageReachLabel(state)).toBe('Used by 1 playlist');
  });

  it('reach without activeNow is not proof either', () => {
    const state = deriveTemplateUsage(
      { 'tpl-1': { playlists: 4, screensReached: 9, activeNow: false } },
      'tpl-1',
    );
    expect(state.kind).toBe('in-playlists');
    expect(usagePillLabel(state)).toBeNull();
  });

  it('a proven-empty row reads Not in use', () => {
    const state = deriveTemplateUsage(
      { 'tpl-1': { playlists: 0, screensReached: 0, activeNow: false } },
      'tpl-1',
    );
    expect(state).toEqual({ kind: 'idle' });
    expect(usagePillLabel(state)).toBe('Not in use');
    expect(usageReachLabel(state)).toBeNull();
  });

  it('singularizes one screen and one playlist', () => {
    const state = deriveTemplateUsage(
      { 'tpl-1': { playlists: 1, screensReached: 1, activeNow: true } },
      'tpl-1',
    );
    expect(usagePillLabel(state)).toBe('LIVE · 1 screen');
    expect(usageReachLabel(state)).toBe('Used by 1 playlist');
  });
});

describe('templateNeedsAttention — §10.5, the SAVED template is broken', () => {
  it('flags a tenant template with no zones (a screen would show nothing)', () => {
    expect(templateNeedsAttention({ isSystem: false, zones: [] })).toBe(true);
  });

  it('never flags a preset', () => {
    expect(templateNeedsAttention({ isSystem: true, zones: [] })).toBe(false);
  });

  it('never flags a template that has content — a slow thumbnail is not a broken template', () => {
    expect(templateNeedsAttention({ isSystem: false, zones: [{}] })).toBe(false);
    expect(templateNeedsAttention({ isSystem: false })).toBe(false);
  });
});

describe('canvasBadgeLabel — §4.4 one compact badge', () => {
  it.each([
    [{ category: 'KIOSK', screenWidth: 1920, screenHeight: 1080 }, 'Touch kiosk'],
    [{ category: 'LOBBY', screenWidth: 3840, screenHeight: 2160 }, 'Landscape'],
    [{ category: 'LOBBY', screenWidth: 2160, screenHeight: 3840 }, 'Portrait'],
    // A 1-panel LED poster chain (320×1080) and a 5:1 LED banner are not
    // "Portrait" and "Landscape" in any useful sense to an operator.
    [{ category: 'LOBBY', screenWidth: 320, screenHeight: 1080 }, 'LED canvas'],
    [{ category: 'LOBBY', screenWidth: 2500, screenHeight: 500 }, 'LED canvas'],
  ])('%o → %s', (t, expected) => {
    expect(canvasBadgeLabel(t)).toBe(expected);
  });

  it('a square canvas is not an LED claim', () => {
    expect(canvasBadgeLabel({ category: 'LOBBY', screenWidth: 1080, screenHeight: 1080 })).toBe('Landscape');
  });
});

describe('lastEditedLabel', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  it.each([
    ['2026-08-31T11:42:00.000Z', 'Edited 18 min ago'],
    ['2026-08-31T09:00:00.000Z', 'Edited 3 hours ago'],
    ['2026-08-30T09:00:00.000Z', 'Edited yesterday'],
    ['2026-08-28T12:00:00.000Z', 'Edited 3 days ago'],
    ['2026-08-24T12:00:00.000Z', 'Edited 1 week ago'],
  ])('%s → %s', (iso, expected) => {
    expect(lastEditedLabel(iso, now)).toBe(expected);
  });

  it('returns null rather than "Invalid Date" for unusable input', () => {
    expect(lastEditedLabel(undefined, now)).toBeNull();
    expect(lastEditedLabel('not-a-date', now)).toBeNull();
  });

  it('clock skew reads as "just now", never a negative age', () => {
    expect(lastEditedLabel('2026-08-31T12:05:00.000Z', now)).toBe('Edited just now');
  });
});
