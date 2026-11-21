/**
 * EMG-04 + FLT-09 (2026-11-21), wired into the page that cannot mount in
 * jsdom — checked the way nativeFirstWiring.test.ts checks its wiring: by
 * reading the source the browser runs. The decisions themselves are
 * unit-tested in pushedMessages.test.ts and durableRefresh.test.ts; this file
 * proves the page actually routes every push, clear, poll answer and durable
 * refresh through them. Each case fails on the page as it was before the fix.
 */
import * as fs from 'fs';
import * as path from 'path';

const PAGE = fs.readFileSync(path.resolve(__dirname, '../page.tsx'), 'utf8');
const OVERLAY = fs.readFileSync(path.resolve(__dirname, '../../../components/player/EmergencyOverlay.tsx'), 'utf8');

function block(src: string, startMarker: string, length = 1500): string {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error(`marker not found: ${startMarker}`);
  return src.slice(i, i + length);
}
function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe('EMG-04 — the page holds every pushed message and clears only by id', () => {
  it('nothing sets the shown message directly any more: one held set, one commit point', () => {
    expect(PAGE).not.toContain('setPushedEmergencyMessage(');
    expect(count(PAGE, 'setPushedMessages(')).toBe(1);
    expect(PAGE).toContain('const pushedEmergencyMessage: EmergencyMessageView | null = useMemo(() => shownPushedMessage(pushedMessages), [pushedMessages]);');
  });

  it('both transports add a push to the held set (WS keeps its eventId fallback; both stamp the server clock)', () => {
    const ws = block(PAGE, "if (msg.type === 'SOS' || msg.type === 'TEXT_BROADCAST' || msg.type === 'MEDIA_ALERT') {", 1400);
    expect(ws).toContain('acceptPushedMessage(pushedEmergencyFromPayload(msg.type as');
    expect(ws).toContain('msg.payload, msg.eventId, pushedServerNow)');
    const sse = block(PAGE, 'const onEmergencyMessage = (type:', 900);
    expect(sse).toContain('acceptPushedMessage(pushedEmergencyFromPayload(type, p, undefined, pushedServerNow))');
  });

  it('both ALL_CLEAR_MESSAGE arms remove only the id the signed payload names', () => {
    const ws = block(PAGE, "} else if (msg.type === 'ALL_CLEAR_MESSAGE') {", 200);
    expect(ws).toContain("clearPushedMessageFromPush(msg.payload, 'WS')");
    expect(PAGE).toContain("handle('ALL_CLEAR_MESSAGE', (pl) => clearPushedMessageFromPush(pl, 'SSE'));");
    const clear = block(PAGE, 'const clearPushedMessageFromPush = useCallback(', 900);
    expect(clear).toContain('pushedClearMessageId(payload)');
    expect(clear).toContain('clearPushedMessage(before, id, performance.now())');
    expect(clear).toContain('pushedClearCountRef.current += 1');
  });

  it('the first push keeps what the overlay poll was showing in the running', () => {
    const accept = block(PAGE, 'const acceptPushedMessage = useCallback(', 700);
    expect(accept).toContain('state.entries.size === 0 && polled && polled.id && polled.id !== message.id');
    expect(PAGE).toContain('onPolledMessageChange={onPolledEmergencyMessageChange}');
    expect(OVERLAY).toContain('useEffect(() => { onPolledMessageChange?.(polled); }, [polled, onPolledMessageChange]);');
    // …and the overlay drops its own copy once the page holds it, so a copy
    // cleared meanwhile cannot come back when the pushed set empties.
    const takeover = block(OVERLAY, 'useEffect(() => {\n    if (message) {', 700);
    expect(takeover).toContain('setPolled(null);');
    expect(takeover).toContain('emptyPollStreakRef.current = 0;');
  });

  it('the stranded-message backstop reconciles every held id and raises what the server lists — same request, same cadence', () => {
    const rec = block(PAGE, 'const reconcilePushedNow = useCallback(', 2200);
    expect(rec).toContain('`${getApiRoot()}/api/v1/emergency/messages`');
    expect(rec).toContain('reconcilePushedMessages(before, {');
    expect(rec).toContain('active: json.active.map(emergencyMessageFromPollRow)');
    expect(rec).toContain('mayAdd: clears === pushedClearCountRef.current');
    expect(rec).toContain("commitPushedMessages(next, 'reconcile')");
    // A failed poll is never a confirmed clear.
    expect(rec).toContain('if (gen !== pushedReconcileGenRef.current || !res.ok) return;');
    // Still interval-only at 12 s while anything is held, plus the two expiry re-checks.
    expect(PAGE).toContain('const h = setInterval(() => { void reconcilePushedNow(); }, 12_000);');
    expect(PAGE).toContain('setTimeout(() => { void reconcilePushedNow(); }, untilExpiry + 1_000)');
    expect(PAGE).toContain('setTimeout(() => { void reconcilePushedNow(); }, untilExpiry + 4_000)');
  });

  it('the overlay poll sorts with the one shared ordering rule and the shared row mapper', () => {
    expect(OVERLAY).toContain('active.sort(compareEmergencyMessages);');
    expect(OVERLAY).toContain('(json.active || []).map(emergencyMessageFromPollRow)');
    expect(OVERLAY).not.toContain('const order = { CRITICAL: 0, WARN: 1, INFO: 2 }');
  });
});

describe('FLT-09 — the durable REFRESH_WEB waits for the alert and runs after it', () => {
  it('the page hands the durable path a live "alert on the glass" check covering every alert form', () => {
    const pred = block(PAGE, 'const refreshAlertOnGlass = useCallback(() => refreshWaitsForAlert({', 500);
    expect(pred).toContain('manifestAlert: !!activeEmergencyRef.current || !!contentIsEmergencyRef.current');
    expect(pred).toContain('pushedMessage: !!pushedEmergencyMessageRef.current');
    expect(pred).toContain('polledMessage: polledEmergencyHeldRef.current');
    expect(pred).toContain('pendingOverride: !!pendingOverrideConfirmRef.current');
    expect(PAGE).toContain('maybeExecuteDurableRefresh(manifest, admitRefreshNow, refreshAlertOnGlass)');
    const wrapper = block(PAGE, 'function maybeExecuteDurableRefresh(', 1200);
    expect(wrapper).toContain('alertOnGlass,');
    expect(wrapper).toContain('return runDurableRefresh(manifest, {');
  });

  it('a deferred command is re-run on BOTH live answers: the 200 (after the apply) and the 304', () => {
    expect(count(PAGE, 'runDurableRefreshNow(')).toBe(2);
    expect(PAGE).toContain('runDurableRefreshNow(manifest);');
    expect(PAGE).toContain('if (lastAppliedManifestRef.current) runDurableRefreshNow(lastAppliedManifestRef.current);');
    const notModified = block(PAGE, 'if (manifestRes.status === 304) {', 6000);
    expect(notModified).toContain('runDurableRefreshNow(lastAppliedManifestRef.current)');
    // …and it runs AFTER the 304's own hold re-evaluation.
    expect(notModified.indexOf('signalDisplayEmergencyHold(holdNow, holdNow')).toBeLessThan(notModified.indexOf('runDurableRefreshNow('));
  });
});
