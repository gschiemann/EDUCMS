/**
 * The surface decision behind the player's red "transition" early-return
 * (launch QA B3, 2026-10-23): a lockdown takes the glass; a routine INFO /
 * WARN text broadcast overlays the running content; nothing regular mounts
 * while an alert's identity is still pending.
 */
import { decideEmergencySurface, isBannerEmergencyMessage, type EmergencySurfaceInput } from '../emergencySurface';

const base: EmergencySurfaceInput = {
  activeEmergency: false,
  pushed: null,
  polledActive: false,
  polledTakeover: false,
  renderHold: false,
  pendingOverrideConfirm: false,
  playlistIsEmergency: false,
};
const warn = { type: 'TEXT_BROADCAST', severity: 'WARN' };
const info = { type: 'TEXT_BROADCAST', severity: 'INFO' };
const critical = { type: 'TEXT_BROADCAST', severity: 'CRITICAL' };
const sos = { type: 'SOS', severity: 'CRITICAL' };
const media = { type: 'MEDIA_ALERT', severity: 'WARN' };

describe('isBannerEmergencyMessage', () => {
  it('INFO / WARN text broadcasts are banners; CRITICAL text, SOS and media alerts are not', () => {
    expect(isBannerEmergencyMessage(warn)).toBe(true);
    expect(isBannerEmergencyMessage(info)).toBe(true);
    expect(isBannerEmergencyMessage(critical)).toBe(false);
    expect(isBannerEmergencyMessage(sos)).toBe(false);
    expect(isBannerEmergencyMessage(media)).toBe(false);
    expect(isBannerEmergencyMessage(null)).toBe(false);
  });
});

describe('decideEmergencySurface', () => {
  it('nothing on → content', () => {
    expect(decideEmergencySurface(base)).toBe('content');
  });

  it('a manifest override (lockdown) takes the glass, hold or not', () => {
    expect(decideEmergencySurface({ ...base, activeEmergency: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, activeEmergency: true, renderHold: true })).toBe('takeover');
    // …even while a WARN banner is also pushed: the lockdown wins.
    expect(decideEmergencySurface({ ...base, activeEmergency: true, pushed: warn })).toBe('takeover');
  });

  it('the emergency PLAYLIST itself renders through the normal branch', () => {
    expect(decideEmergencySurface({ ...base, activeEmergency: true, renderHold: true, playlistIsEmergency: true })).toBe('content');
  });

  it('a pending signed OVERRIDE (manifest confirm in flight) is protective: takeover', () => {
    expect(decideEmergencySurface({ ...base, pendingOverrideConfirm: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pendingOverrideConfirm: true, pushed: warn })).toBe('takeover');
  });

  it('a pushed WARN / INFO broadcast OVERLAYS the running content — also when it raised the hold itself', () => {
    expect(decideEmergencySurface({ ...base, pushed: warn })).toBe('overlay');
    expect(decideEmergencySurface({ ...base, pushed: info, renderHold: true })).toBe('overlay');
  });

  it('a pushed CRITICAL text, SOS or media alert takes the glass', () => {
    expect(decideEmergencySurface({ ...base, pushed: critical })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pushed: sos, renderHold: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pushed: media })).toBe('takeover');
  });

  it('a poll-only message follows the same rule', () => {
    expect(decideEmergencySurface({ ...base, polledActive: true, polledTakeover: false, renderHold: true })).toBe('overlay');
    expect(decideEmergencySurface({ ...base, polledActive: true, polledTakeover: true, renderHold: true })).toBe('takeover');
  });

  it('the hold raised with no identified alert is protective (eager WS raise, reload under a persisted hold)', () => {
    expect(decideEmergencySurface({ ...base, renderHold: true })).toBe('takeover');
  });

  it('a stale polledTakeover flag without an active poll never takes the glass', () => {
    expect(decideEmergencySurface({ ...base, polledActive: false, polledTakeover: true })).toBe('content');
  });
});
