/**
 * The screen PIN, wired into page.tsx (2026-11-09). page.tsx cannot mount in
 * jsdom, so — like remoteDialogWiring.test.ts — the wiring is checked on the
 * source the browser runs. Behaviour: unpairPin.test.ts, UnpairPinPad.test.tsx,
 * deviceTokenSession.test.ts (restore) and the API's screen-pin.spec.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

const PAGE = fs.readFileSync(path.resolve(__dirname, '..', 'page.tsx'), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const SRC = code(PAGE);

function body(startMarker: string, endMarker: string): string {
  const start = SRC.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('handleUnpair', () => {
  const fn = () => body('const handleUnpair = async (pin?: string) => {', "if (nativeFire('unpair')) return;");

  it('with NO PIN known keeps today’s order: invalidate before the server await, teardown regardless of the answer', () => {
    const b = fn();
    const invalidateFirst = b.indexOf('if (!pinKnown) deviceTokenSession.invalidate();');
    const request = b.indexOf('await requestServerUnpair(');
    const teardown = b.indexOf("localStorage.removeItem('edu_device_token')");
    expect(invalidateFirst).toBeGreaterThan(-1);
    expect(invalidateFirst).toBeLessThan(request);
    expect(request).toBeLessThan(teardown);
  });

  it('with a PIN known it asks first and tears nothing down until the server says yes', () => {
    const b = fn();
    const ask = b.indexOf("if (pinKnown && pin === undefined) {");
    const open = b.indexOf("dispatchPinPad({ type: 'open' });");
    const request = b.indexOf('await requestServerUnpair(');
    const refusedReturn = b.indexOf("if (decision.kind !== 'proceed') {");
    const lateInvalidate = b.indexOf('if (pinKnown) deviceTokenSession.invalidate();');
    const teardown = b.indexOf("localStorage.removeItem('edu_device_token')");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(open);
    expect(open).toBeLessThan(request);
    expect(request).toBeLessThan(refusedReturn);
    expect(refusedReturn).toBeLessThan(lateInvalidate);
    expect(lateInvalidate).toBeLessThan(teardown);
  });

  it('a refusal returns before any local teardown, and restores the credential only when it was retired', () => {
    const b = fn();
    const refused = b.slice(b.indexOf("if (decision.kind !== 'proceed') {"), b.indexOf('if (pinKnown) deviceTokenSession.invalidate();'));
    expect(refused).toContain('if (!pinKnown) deviceTokenSession.restore(token);');
    expect(refused).toMatch(/return;\s*\}\s*$/);
    expect(refused).not.toContain('removeItem');
    expect(refused).not.toContain("nativeFire('unpair')");
  });

  it('the PIN goes to the server call (body), never into a URL', () => {
    expect(fn()).toContain('requestServerUnpair({ apiRoot: getApiRoot(), fingerprint: fp, token, pin })');
  });
});

describe('the keypad follows the dialog rules', () => {
  it('Back: the alert lock, then the question, then the keypad, then the editor', () => {
    const b = body('const onShowStop = () => {', "window.addEventListener('edu-show-stop-overlay'");
    const lock = b.indexOf('activeEmergencyRef.current || pushedEmergencyMessageRef.current');
    const question = b.indexOf('if (remoteDialogRef.current.open) {');
    const pad = b.indexOf('if (pinPadRef.current.open) {');
    const editor = b.indexOf('showCanvasEditorRef.current');
    expect(lock).toBeLessThan(question);
    expect(question).toBeLessThan(pad);
    expect(pad).toBeLessThan(editor);
    expect(b.slice(pad)).toMatch(/^if \(pinPadRef\.current\.open\) \{\s*dispatchPinPad\(\{ type: 'back' \}\);\s*return;/);
  });

  it('Backspace reaches the pad (delete) instead of Back only while the pad is open', () => {
    expect(SRC).toMatch(/if \(key === 'Backspace' && pinPadRef\.current\.open\) return;\s*if \(key === 'Escape' \|\| key === 'Backspace'/);
  });

  it('an alert closes it and hides it in the same commit; a surface change closes it', () => {
    expect(SRC).toMatch(/if \(remoteDialogBlockedByAlert\) dispatchPinPad\(\{ type: 'close' \}\);/);
    expect(SRC).toContain('{pinPad.open && !remoteDialogBlockedByAlert ? (');
    expect(SRC).toMatch(/dispatchPinPad\(\{ type: 'close' \}\);\s*\}, \[playbackStopped, dispatchPinPad\]\);/);
  });

  it('is mounted once, inside the paired card, right after the question dialog', () => {
    const dialog = SRC.indexOf('<RemoteDialog');
    const pad = SRC.indexOf('<UnpairPinPad');
    expect(pad).toBeGreaterThan(dialog);
    expect(SRC.indexOf('<UnpairPinPad', pad + 1)).toBe(-1);
  });
});

describe('what stays ungated', () => {
  it('"Exit to device home" never consults the PIN', () => {
    const exit = body('const handleExitApp', 'const handleUnpair = async');
    expect(exit).not.toMatch(/pinPad|unpairPin|PinPad/);
    expect(exit).toContain("nativeFire('exitToDeviceHome')");
  });

  it('the server-driven TENANT_CHANGED teardown never consults the PIN', () => {
    const start = SRC.indexOf('isTenantChangeForThisScreen(msg, screenId)');
    expect(start).toBeGreaterThan(-1);
    const seg = SRC.slice(start, SRC.indexOf("setPhase('registering');", start));
    expect(seg).toContain("nativeFire('unpair')");
    expect(seg).not.toMatch(/pinPad|unpairPin|PinPad|requestServerUnpair/);
  });

  it('the manifest flag is read through the emergency-safe reader only', () => {
    expect(SRC).toContain('readManifestUnpairPin(unpairPinRequiredRef.current, manifest)');
  });
});
