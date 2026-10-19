/**
 * Native-first, wired into the 15k-line page (which cannot mount in jsdom),
 * checked the way glassContinuityWiring.test.ts checks its wiring: by reading
 * the source the browser runs.
 *
 *   §7 E1 — UNCHANGED: the hold is raised BEFORE the preempt manifest fetch on
 *           WS and SSE OVERRIDE, and before the pushed-message state of SOS /
 *           TEXT_BROADCAST / MEDIA_ALERT. Native-first moved none of it.
 *   §7 E2 — decideFaceEngine reads the raised hold and emergency content.
 *   §3.1  — the decision runs BEFORE the web-first takeover is even built, and
 *           a native / wait decision mounts the slot (no web child).
 *   §4.3  — a booting page never treats "I just booted" as "nothing on glass":
 *           decidePlaylistCommit reads the app's presenting state, and nothing
 *           is released before the first manifest apply or under the hold.
 *   §3.5  — the sync nudge rides AFTER applyManifest (emergency step first).
 */
import * as fs from 'fs';
import * as path from 'path';

const PAGE = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');

function before(haystack: string, a: string, b: string, from = 0): boolean {
  const i = haystack.indexOf(a, from);
  const j = haystack.indexOf(b, i === -1 ? from : i);
  return i !== -1 && j !== -1 && i < j;
}
function block(startMarker: string, length = 1500): string {
  const i = PAGE.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  return PAGE.slice(i, i + length);
}

describe('§7 E1 — the hold ordering is untouched', () => {
  it('WS OVERRIDE: hold, then the confirmation window, then the preempt fetch', () => {
    const ws = block("if (msg.type === 'OVERRIDE') {\n                signalDisplayEmergencyHold(true, true);", 2200);
    expect(before(ws, 'signalDisplayEmergencyHold(true, true)', 'preemptReconcile()')).toBe(true);
  });
  it('SSE OVERRIDE: hold, then the preempt fetch', () => {
    const sse = block("handle('OVERRIDE'", 2500);
    expect(before(sse, 'signalDisplayEmergencyHold(true, true)', 'preemptReconcile()')).toBe(true);
  });
  it('SOS / TEXT_BROADCAST / MEDIA_ALERT: hold, then the pushed-message state (both transports)', () => {
    const sse = block('const onEmergencyMessage = (type:', 600);
    expect(before(sse, 'signalDisplayEmergencyHold(true, true)', 'setPushedEmergencyMessage(')).toBe(true);
    const ws = block("if (msg.type === 'SOS' || msg.type === 'TEXT_BROADCAST' || msg.type === 'MEDIA_ALERT') {", 600);
    expect(before(ws, 'signalDisplayEmergencyHold(true, true)', 'setPushedEmergencyMessage(')).toBe(true);
  });
  it('applyManifest decides the alert before native-first marks the page decided', () => {
    const apply = block('const applyManifest = (manifest: any, fromCache = false) => {', 9000);
    expect(before(apply, 'signalDisplayEmergencyHold(holdNow, holdNow)', 'nativeFirstDecidedRef.current = true')).toBe(true);
    expect(before(apply, 'setActiveEmergency(em)', 'nativeFirstDecidedRef.current = true')).toBe(true);
  });
});

describe('§7 E2 / §3.1 — the decision before the mount', () => {
  it('decideFaceEngine is fed the raised hold and emergency content', () => {
    const fn = block('const nativeFirstDecisionFor = (item: any, solo: boolean)', 3000);
    expect(fn).toMatch(/emergencyContent: playlist\?\.isEmergency === true/);
    expect(fn).toMatch(/holdRaised: nativeFirstHoldRaised/);
    expect(PAGE).toMatch(/const nativeFirstHoldRaised = !!activeEmergency \|\| !!pushedEmergencyMessage \|\| !!pendingOverrideConfirmRef\.current;/);
  });
  it('the slide decides BEFORE the web-first takeover is built, and native / wait mount the slot', () => {
    expect(before(PAGE, 'const nativeFirstSlide = nativeFirstDecisionFor(item', 'const nativeChoice = pickNativeVideo({')).toBe(true);
    const slide = block('const nativeFirstSlide = nativeFirstDecisionFor(item', 1200);
    expect(slide).toMatch(/decision\.engine !== 'web'/);
    expect(slide).toMatch(/<NativeSoloSlot /);
    // A settled content never re-enters the takeover (no flip back).
    expect(PAGE).toMatch(/v2Blocked: !!nativeVideoDescriptor && \(nativeFirstSettled \|\|/);
  });
  it('an app without v4 keeps today\'s path byte for byte (the decision answers null)', () => {
    const fn = block('const nativeFirstDecisionFor = (item: any, solo: boolean)', 800);
    expect(fn).toMatch(/if \(!face \|\| !facts \|\| facts\.protocolMax < NATIVE_FIRST_PROTOCOL\) return null;/);
  });
});

describe('§4.3 — re-attach and the page side of the transitions', () => {
  it('decidePlaylistCommit counts a presenting native session as regular content on glass (not under a hold)', () => {
    expect(PAGE).toMatch(/\(!holdNow && !!nativeFirstFaceRef\.current\?\.presenting\(\)\)/);
  });
  it('nothing native is sent under the hold or before the first manifest apply; web is painted before the release', () => {
    const fx = block('// The PAGE side of §4.3 / §3.2', 3200);
    expect(fx).toMatch(/nativeFirstHoldRaised \|\| displayEmergencyHoldRaised\(\) \|\| !nativeFirstDecidedRef\.current\) return;/);
    expect(before(fx, 'requestAnimationFrame(', "face.release(action.at)")).toBe(true);
  });
  it('readiness of the native file reads the store in store mode at every readiness site', () => {
    expect(PAGE).toMatch(/readyItemIds\(readinessItems, readinessInputs\.cacheDrive, readinessInputs\.onDisk\)/);
    expect(PAGE).toMatch(/anyReady: readyItemIds\(commit\.readiness, commitReadiness\.cacheDrive, commitReadiness\.onDisk\)/);
    expect(PAGE).toMatch(/readyItemIds\(pending\.readiness, inputs\.cacheDrive, inputs\.onDisk\)\.size === 0/);
  });
});

describe('§3.5 — the sync nudge', () => {
  it('rides after the live apply, with the manifest ETag as its tag', () => {
    const live = block('        applyManifest(manifest);\n', 900);
    expect(before(live, 'applyManifest(manifest);', 'nativeFirstFaceRef.current?.sync(tag')).toBe(true);
    expect(live).toMatch(/nativeManifestTag\(manifestEtagRef\.current\)/);
  });
});
