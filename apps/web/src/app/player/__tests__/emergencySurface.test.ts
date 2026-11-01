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

  // 2026-10-26 — a CLEARED custom message must not flash an alert board on its
  // way out. The hold it raised is released by the manifest one round trip
  // later; when the page knows the message was the hold's only reason, the
  // content stays (messageEnd.ts). The flag is checked LAST, so every real
  // alert still takes the glass first.
  describe('messageEnded — a message that ends leaves content, never a board', () => {
    it('hold still engaged, the ended message was the only reason → content (no red board, no black screen)', () => {
      expect(decideEmergencySurface({ ...base, renderHold: true, messageEnded: true })).toBe('content');
    });

    it('absent / false is exactly the old decision (hold engaged, nothing identified → black hold)', () => {
      expect(decideEmergencySurface({ ...base, renderHold: true })).toBe('hold');
      expect(decideEmergencySurface({ ...base, renderHold: true, messageEnded: false })).toBe('hold');
    });

    it('does nothing when there is no hold to explain', () => {
      expect(decideEmergencySurface({ ...base, messageEnded: true })).toBe('content');
    });

    it('never outranks a real alert: a lockdown, a pending OVERRIDE, a pushed or polled message still take the glass', () => {
      const ended = { ...base, renderHold: true, messageEnded: true };
      expect(decideEmergencySurface({ ...ended, activeEmergency: true })).toBe('takeover');
      expect(decideEmergencySurface({ ...ended, pendingOverrideConfirm: true })).toBe('takeover');
      expect(decideEmergencySurface({ ...ended, pushed: critical })).toBe('takeover');
      expect(decideEmergencySurface({ ...ended, pushed: sos })).toBe('takeover');
      expect(decideEmergencySurface({ ...ended, polledActive: true, polledTakeover: true })).toBe('takeover');
    });

    it('a NEW banner after the end overlays the content as usual', () => {
      expect(decideEmergencySurface({ ...base, renderHold: true, messageEnded: true, pushed: info })).toBe('overlay');
    });

    it('Info banner → clear: overlay, then content — the sequence never visits takeover or hold', () => {
      const sequence = [
        decideEmergencySurface({ ...base, renderHold: true, pushed: info }),
        decideEmergencySurface({ ...base, renderHold: true, messageEnded: true }),
        decideEmergencySurface({ ...base, renderHold: false }),
      ];
      expect(sequence).toEqual(['overlay', 'content', 'content']);
    });

    it('Critical message → clear: takeover, then content (a board never follows the clear)', () => {
      const sequence = [
        decideEmergencySurface({ ...base, renderHold: true, pushed: critical }),
        decideEmergencySurface({ ...base, renderHold: true, messageEnded: true }),
        decideEmergencySurface({ ...base, renderHold: false }),
      ];
      expect(sequence).toEqual(['takeover', 'content', 'content']);
    });
  });
});
