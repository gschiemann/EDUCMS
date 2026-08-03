import {
  buildSpatialNavShim,
  resolveParentOrigins,
  VOSNAV_COMMANDS,
  VOSNAV_NS,
  OPAQUE_STORAGE_POLYFILL,
} from './spatial-nav-shim';

/**
 * INJ-001a (2026-08-02) — the spatial-nav shim moved server-side so the
 * WEBPAGE proxy iframe could be sandboxed WITHOUT `allow-same-origin`
 * (which killed the old `iframe.contentWindow.eval(SHIM_JS)` injector).
 *
 * These specs pin the properties that make the replacement safe. The
 * behavioural half (does an `arm`/`down` actually move focus, is a bad source
 * rejected) lives in
 * apps/web/src/components/widgets/__tests__/spatial-nav-protocol.test.ts,
 * which executes THIS shim inside jsdom.
 */
describe('resolveParentOrigins', () => {
  it('normalises and de-dupes ALLOWED_ORIGINS entries', () => {
    expect(
      resolveParentOrigins('https://app.example.com/, https://app.example.com , https://b.example.com'),
    ).toEqual(['https://app.example.com', 'https://b.example.com']);
  });

  it('drops malformed entries instead of throwing at request time', () => {
    expect(resolveParentOrigins('not a url, https://ok.example.com')).toEqual([
      'https://ok.example.com',
    ]);
  });

  it('falls back to the local dev origins when ALLOWED_ORIGINS is unset/empty', () => {
    expect(resolveParentOrigins('')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('never returns an empty allowlist (an empty list would silently disable nav)', () => {
    expect(resolveParentOrigins('garbage, also-garbage').length).toBeGreaterThan(0);
  });
});

describe('buildSpatialNavShim', () => {
  const shim = buildSpatialNavShim(['https://app.example.com']);

  it('bakes the server-controlled allowlist in, not anything request-derived', () => {
    expect(shim).toContain('"https://app.example.com"');
  });

  it('contains NO code-execution primitive — the channel can never carry code', () => {
    // A command payload is a bare enum string; there is deliberately no path
    // from a message to script execution. If any of these ever appear here,
    // the postMessage channel has become an RCE surface.
    expect(shim).not.toMatch(/\beval\s*\(/);
    expect(shim).not.toMatch(/new\s+Function\s*\(/);
    expect(shim).not.toMatch(/\bdocument\.write\b/);
    expect(shim).not.toMatch(/\.innerHTML\s*=/);
    expect(shim).not.toMatch(/setTimeout\s*\(\s*["']/);
  });

  it('checks BOTH the message source and the origin allowlist', () => {
    expect(shim).toContain('e.source!==window.parent');
    expect(shim).toContain('PARENTS.indexOf(e.origin)===-1');
  });

  it('gates on the versioned namespace and the fixed command enum', () => {
    expect(shim).toContain(`var NS=${JSON.stringify(VOSNAV_NS)}`);
    expect(shim).toContain('d.vosnav!==NS');
    expect(shim).toContain('CMDS.indexOf(cmd)===-1');
    for (const cmd of VOSNAV_COMMANDS) expect(shim).toContain(`"${cmd}"`);
  });

  it('installs INERT — no focus stealing until an allowlisted parent arms it', () => {
    // The 2026-06-08 "every menu click needs two clicks" fire was the shim
    // auto-focusing inside dashboard preview iframes. The MutationObserver and
    // the initial focus timer must both live inside arm().
    const armBody = shim.slice(shim.indexOf('function arm()'), shim.indexOf('function disarm()'));
    expect(armBody).toContain('MutationObserver');
    expect(armBody).toContain('focusFirstIfIdle');
    // and the keydown handler must be a no-op while disarmed
    expect(shim).toContain("document.addEventListener('keydown',function(e){if(!armed)return;");
  });

  it('is ES5 / Chromium-83 safe (Taurus LED controllers)', () => {
    expect(shim).not.toMatch(/=>/);
    expect(shim).not.toMatch(/\b(const|let)\s/);
    expect(shim).not.toMatch(/`/);
    expect(shim).not.toMatch(/\?\./);
    expect(shim).not.toMatch(/\.includes\(/);
  });

  it('cannot break out of the <script> element it is embedded in', () => {
    expect(shim.slice(8, -9)).not.toMatch(/<\/script/i);
  });
});

describe('OPAQUE_STORAGE_POLYFILL', () => {
  it('only installs a shim when real storage is unavailable', () => {
    // A null-origin document throws SecurityError on localStorage; the probe
    // + try/catch means a normal same-origin document keeps REAL storage.
    expect(OPAQUE_STORAGE_POLYFILL).toContain('__vos_probe');
    expect(OPAQUE_STORAGE_POLYFILL).toContain('if(ok)return;');
  });

  it('is ES5 safe', () => {
    expect(OPAQUE_STORAGE_POLYFILL).not.toMatch(/=>/);
    expect(OPAQUE_STORAGE_POLYFILL).not.toMatch(/\b(const|let)\s/);
  });
});
