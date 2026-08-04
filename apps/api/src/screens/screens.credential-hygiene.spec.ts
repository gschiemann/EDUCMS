/**
 * SDE-03 + AUTHZ-03 (2026-08-04) — two credential/telemetry hygiene fixes on
 * anonymous or device-facing screen routes.
 *
 * SDE-03 — the device-initiated unpair minted a fresh pairing code and wrote it
 * into an AuditLog row belonging to the tenant that had just LOST the screen.
 * `GET /api/v1/audit` is scoped to that tenant and returns `details` verbatim,
 * so any admin of the previous owner could read a live claim credential: the
 * pairing code is what `POST /screens/pair` looks a screen up by, and right
 * after an unpair the row's tenantId is null, so the SCREEN_ALREADY_PAIRED
 * guard does not fire. The disowner kept a permanent key back into a display
 * they no longer possess.
 *
 * AUTHZ-03 — `POST /screens/status/:fp/crash-report` is unauthenticated BY
 * DESIGN (the shipped APKs send no Authorization header, and a crash report
 * comes from a dying process). It stays anonymous. What changed is that a
 * report now records WHETHER the caller proved possession, and that
 * client-controlled fields are CR/LF-stripped before being interpolated into
 * the Railway log stream — the one surface where this data is actually read.
 */

import { oneLineLog } from './screens.controller';

describe('AUTHZ-03 — oneLineLog defeats log injection from an anonymous route', () => {
  it('collapses CR, LF and the Unicode line separators', () => {
    expect(oneLineLog('a\nb')).toBe('a b');
    expect(oneLineLog('a\r\nb')).toBe('a b');
    expect(oneLineLog('a b')).toBe('a b');
    expect(oneLineLog('a b')).toBe('a b');
  });

  it('kills a forged report trying to write its own convincing log line', () => {
    // The attack: a crash `message` that closes the quote and appends what
    // looks like a second, genuine entry from another screen.
    const forged =
      'boom"\n[crash] fp=000000000000000000… authed=true source=player version=9.9.9 message="all good';
    const out = oneLineLog(forged);
    expect(out).not.toContain('\n');
    // Everything stays on ONE line, so the fake entry cannot masquerade as its
    // own record in the operator's scroll.
    expect(out.split('\n')).toHaveLength(1);
  });

  it('leaves ordinary text and null/undefined alone', () => {
    expect(oneLineLog('NullPointerException at Foo.kt:42')).toBe('NullPointerException at Foo.kt:42');
    expect(oneLineLog(null)).toBe('');
    expect(oneLineLog(undefined)).toBe('');
  });
});

describe('SDE-03 — the unpair audit row never carries the fresh pairing code', () => {
  // Rather than stand up the whole controller, assert the property that
  // matters against the real source: the details object written in the
  // device-unpair transaction must not reference newPairingCode.
  const src: string = require('fs').readFileSync(
    require('path').join(__dirname, 'screens.controller.ts'),
    'utf8',
  );

  it('writes pairingCodeRotated, not the code itself', () => {
    const block = src.slice(
      src.indexOf("action: 'SCREEN_UNPAIRED_BY_DEVICE'"),
      src.indexOf("action: 'SCREEN_UNPAIRED_BY_DEVICE'") + 2500,
    );
    expect(block).toContain('pairingCodeRotated: true');
    // The credential itself must not be persisted, in any form — including a
    // truncated prefix, which would still cut the claim search space ~1000x.
    expect(block).not.toMatch(/newPairingCode\s*,/);
    expect(block).not.toMatch(/newPairingCode\.slice/);
  });

  it('still returns the code to the device that proved possession', () => {
    // The device that just unpaired is the ONE correct recipient — it needs
    // the code to display for re-claiming. Only the audit row was the leak.
    expect(src).toContain('return { ok: true, screenId: screen.id, newPairingCode };');
  });

  it('keeps the forensic fields the event is actually for', () => {
    const block = src.slice(
      src.indexOf("action: 'SCREEN_UNPAIRED_BY_DEVICE'"),
      src.indexOf("action: 'SCREEN_UNPAIRED_BY_DEVICE'") + 2500,
    );
    for (const field of ['name:', 'fingerprint,', 'previousTenantId,']) {
      expect(block).toContain(field);
    }
  });
});
