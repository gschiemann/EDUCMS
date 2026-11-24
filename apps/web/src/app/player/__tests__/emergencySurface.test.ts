/**
 * The surface decision behind the player's red "transition" early-return
 * (launch QA B3, 2026-10-23): a lockdown takes the glass; a routine INFO /
 * WARN text broadcast overlays the running content; nothing regular mounts
 * while an alert's identity is still pending.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { decideEmergencySurface, drawnPushedMessage, isBannerEmergencyMessage, pendingTextHiddenBy, tenantAlertOnGlass, type EmergencySurfaceInput } from '../emergencySurface';

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

describe('decideEmergencySurface — the app refused banner posture (2026-11-02)', () => {
  it('a refused banner is a full takeover, pushed or polled; an unrefused one still overlays', () => {
    expect(decideEmergencySurface({ ...base, pushed: info, renderHold: true, playbackHeld: true, bannerRefused: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pushed: warn, renderHold: true, playbackHeld: true, bannerRefused: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, polledActive: true, polledTakeover: false, renderHold: true, bannerRefused: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pushed: info, renderHold: true, bannerRefused: false })).toBe('overlay');
  });

  it('a refusal never changes CRITICAL / lockdown / SOS takeovers or an emergency playlist', () => {
    expect(decideEmergencySurface({ ...base, pushed: sos, bannerRefused: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, activeEmergency: true, bannerRefused: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, playlistIsEmergency: true, pushed: info, bannerRefused: true })).toBe('content');
  });
});

describe('a tenant alert outranks a banner (2026-11-23, a drill over a broadcast)', () => {
  const none = { activeEmergency: false, pendingOverrideConfirm: false, playlistIsEmergency: false };
  it('a manifest alert, a pending signed OVERRIDE or the staged emergency board is a tenant alert on the glass', () => {
    expect(tenantAlertOnGlass(none)).toBe(false);
    expect(tenantAlertOnGlass({ ...none, activeEmergency: true })).toBe(true);
    expect(tenantAlertOnGlass({ ...none, pendingOverrideConfirm: true })).toBe(true);
    expect(tenantAlertOnGlass({ ...none, playlistIsEmergency: true })).toBe(true);
  });
  it('an INFO / WARN banner is held but not drawn over a tenant alert; it is drawn again once the alert is gone', () => {
    expect(drawnPushedMessage(info, true)).toBeNull();
    expect(drawnPushedMessage(warn, true)).toBeNull();
    expect(drawnPushedMessage(info, false)).toBe(info);
    expect(drawnPushedMessage(null, true)).toBeNull();
  });
  it('a full-screen SOS / MEDIA_ALERT / CRITICAL text keeps today\'s draw over a tenant alert', () => {
    expect(drawnPushedMessage(sos, true)).toBe(sos);
    expect(drawnPushedMessage(media, true)).toBe(media);
    expect(drawnPushedMessage(critical, true)).toBe(critical);
  });
  it('the takeover itself is unchanged: a tenant alert with a held banner is still a takeover', () => {
    expect(decideEmergencySurface({ ...base, activeEmergency: true, pushed: info, renderHold: true })).toBe('takeover');
    expect(decideEmergencySurface({ ...base, pendingOverrideConfirm: true, pushed: warn, renderHold: true })).toBe('takeover');
  });
  it('under a tenant alert the protective pending words are hidden only by a full-screen pushed message, never by a banner', () => {
    expect(pendingTextHiddenBy(null, true)).toBe(false);
    expect(pendingTextHiddenBy(info, true)).toBe(false);
    expect(pendingTextHiddenBy(warn, true)).toBe(false);
    expect(pendingTextHiddenBy(sos, true)).toBe(true);
    expect(pendingTextHiddenBy(critical, true)).toBe(true);
  });
  it('with no tenant alert a banner-class message hides the words as before: the surface is only its full-screen form (the app refused banner posture), and the words would claim an emergency that is not there', () => {
    expect(decideEmergencySurface({ ...base, pushed: info, bannerRefused: true })).toBe('takeover');
    expect(pendingTextHiddenBy(info, false)).toBe(true);
    expect(pendingTextHiddenBy(warn, false)).toBe(true);
    expect(pendingTextHiddenBy(sos, false)).toBe(true);
    expect(pendingTextHiddenBy(null, false)).toBe(false);
  });
});

// The helpers above are only half the protection: the page must hand them the
// tenant alert. If the call site passed `false` instead of `tenantAlertUp`, a
// banner held while a signed OVERRIDE is confirmed would leave a coloured
// surface with no words, and every case above would still pass. So pin the
// wiring in the real file, parsed (comments cannot satisfy it).
describe('page.tsx hands the tenant alert to the banner, the paint identity and the pending words', () => {
  const file = path.join(__dirname, '..', 'page.tsx');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const text = (n: ts.Node) => n.getText(sf).replace(/\s+/g, ' ');
  const nodes: ts.Node[] = [];
  const visit = (n: ts.Node) => { nodes.push(n); ts.forEachChild(n, visit); };
  visit(sf);
  const callArgs = (name: string) => nodes
    .filter((n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name)
    .map((c) => c.arguments.map(text));
  const objectProp = (call: string[] | undefined, key: string) => {
    const obj = call?.[0] ?? '';
    const m = obj.match(new RegExp(`\\b${key}: ([^,}]+)`));
    return m ? m[1].trim() : null;
  };

  it('tenantAlertUp is the tenant alert, read from the same pending-OVERRIDE ref the surface decision reads', () => {
    const decl = nodes.find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'tenantAlertUp');
    expect(decl?.initializer && ts.isCallExpression(decl.initializer) && text(decl.initializer.expression)).toBe('tenantAlertOnGlass');
    const alert = callArgs('tenantAlertOnGlass');
    expect(alert).toHaveLength(1);
    expect(objectProp(alert[0], 'pendingOverrideConfirm')).toBe('!!pendingOverrideConfirmRef.current');
    expect(objectProp(alert[0], 'activeEmergency')).toBe('!!activeEmergency');
    expect(objectProp(alert[0], 'playlistIsEmergency')).toBe('playlist?.isEmergency === true');
    const surface = callArgs('decideEmergencySurface');
    expect(surface).toHaveLength(1);
    expect(objectProp(surface[0], 'pendingOverrideConfirm')).toBe('!!pendingOverrideConfirmRef.current');
  });

  it('the pending words, the drawn message and the overlay banner all take tenantAlertUp', () => {
    expect(callArgs('pendingTextHiddenBy')).toEqual([['pushedEmergencyMessage', 'tenantAlertUp']]);
    expect(callArgs('drawnPushedMessage')).toEqual([['pushedEmergencyMessage', 'tenantAlertUp']]);
    const suppress = nodes
      .filter((n): n is ts.JsxAttribute => ts.isJsxAttribute(n) && text(n.name) === 'suppressBanner')
      .map((a) => (a.initializer ? text(a.initializer) : ''));
    expect(suppress).toEqual(['{tenantAlertUp}']);
  });
});
