import { BANNER_PRESET_COLORS, readableTextOn } from '@cms/api-types';
import { bannerForSend, contrastReport, durationMinutesFor, resolveColorChoice } from '../broadcast-banner';

describe('automatic text colour (WCAG AA)', () => {
  it('picks white on dark and dark on light backgrounds', () => {
    expect(readableTextOn('#1d4ed8').text).toBe('#ffffff');
    expect(readableTextOn('#0f172a').text).toBe('#ffffff');
    expect(readableTextOn('#facc15').text).toBe('#0f172a');
    expect(readableTextOn('#ffffff').text).toBe('#0f172a');
  });
  it('every curated preset reaches AA', () => {
    for (const p of BANNER_PRESET_COLORS) expect(readableTextOn(p.hex).passesAA).toBe(true);
  });
  it('flags a mid-tone that neither white nor dark text can carry', () => {
    const r = readableTextOn('#777777');
    expect(r.passesAA).toBe(false);
    expect(r.ratio).toBeLessThan(4.5);
    expect(contrastReport('#777777')?.passesAA).toBe(false);
  });
  it('the ratio matches the WCAG formula (black on white = 21)', () => {
    expect(readableTextOn('#ffffff').ratio).toBeGreaterThan(17);
    expect(contrastReport(null)).toBeNull();
  });
});

describe('colour choices', () => {
  const brand = { primary: '#0a6cff', accent: null };
  it('resolves each kind', () => {
    expect(resolveColorChoice({ kind: 'default' }, brand)).toBeNull();
    expect(resolveColorChoice({ kind: 'brand-primary' }, brand)).toBe('#0a6cff');
    expect(resolveColorChoice({ kind: 'brand-accent' }, brand)).toBeNull();
    expect(resolveColorChoice({ kind: 'preset', id: 'green' }, brand)).toBe('#15803d');
    expect(resolveColorChoice({ kind: 'custom', hex: 'ABC' }, brand)).toBe('#aabbcc');
    expect(resolveColorChoice({ kind: 'custom', hex: '#12' }, brand)).toBeNull();
  });
  it('builds the send payload', () => {
    expect(bannerForSend('#15803d', 'scroll', 'fast')).toEqual({ color: '#15803d', mode: 'scroll', speed: 'fast' });
    expect(bannerForSend(null, 'static', 'normal')).toEqual({ mode: 'static', speed: 'normal' });
  });
});

describe('auto-clear durations', () => {
  const at = new Date(2026, 10, 1, 21, 30, 0, 0);
  it('maps presets to minutes', () => {
    expect(durationMinutesFor('15m', 5, at)).toBe(15);
    expect(durationMinutesFor('1h', 5, at)).toBe(60);
    expect(durationMinutesFor('4h', 5, at)).toBe(240);
    expect(durationMinutesFor('manual', 5, at)).toBe(1440);
    expect(durationMinutesFor('custom', 7, at)).toBe(7);
  });
  it('end of day is the time left until local midnight', () => {
    expect(durationMinutesFor('eod', 5, at)).toBe(150);
    expect(durationMinutesFor('eod', 5, new Date(2026, 10, 1, 23, 59, 30))).toBe(1);
  });
});
