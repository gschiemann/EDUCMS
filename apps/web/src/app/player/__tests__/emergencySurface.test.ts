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

  // 2026-10-26 (the MEDICAL drill at a launch site): a page that reloads
  // under a persisted native hold has no alert to name yet — content must
  // not mount (rule 11), but the page may not claim a red "EMERGENCY" it has
  // no evidence for (rule 10), least of all during a drill. Black, until the
  // live manifest decides. A signed OVERRIDE awaiting its manifest is still a
  // takeover: the push named an alert.
  it('the hold engaged with no identified alert is protective but unattributed: hold (black), never a red claim', () => {
    expect(decideEmergencySurface({ ...base, renderHold: true })).toBe('hold');
    expect(decideEmergencySurface({ ...base, renderHold: true, pendingOverrideConfirm: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, renderHold: true, activeEmergency: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, renderHold: true, pushed: sos })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, renderHold: true, playlistIsEmergency: true })).toBe('content');
  });

  it('a stale polledTakeover flag without an active poll never takes the glass', () => {
    expect(decideEmergencySurface({ ...base, polledActive: false, polledTakeover: true })).toBe('content');
  });

  it('a cleared banner keeps content mounted while the display hold awaits manifest confirmation', () => {
    expect(decideEmergencySurface({ ...base, renderHold: true, playbackHeld: false })).toBe('content');
    expect(decideEmergencySurface({ ...base, renderHold: true, playbackHeld: false, activeEmergency: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, renderHold: true, playbackHeld: false, pushed: critical })).toBe('takeover');
  });
});
