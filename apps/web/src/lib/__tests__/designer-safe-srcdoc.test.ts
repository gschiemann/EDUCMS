import { buildSafeDesignerSrcdoc } from '../designer-safe-srcdoc';

/**
 * W0-02 (audit 2026-07-12) — render-side containment for AI-authored board
 * HTML. Runnable with: pnpm --filter web exec jest src/lib/designer-safe-srcdoc
 *
 * This is the belt-and-suspenders layer (the API-side sanitizeDesignerHtml is
 * the primary strip, gated by designer-prompt.spec.ts). It contains LEGACY
 * persisted boards that were saved before the source strip existed.
 */

const MALICIOUS = [
  '<!doctype html><html><head><style>.s{color:red}</style></head>',
  '<body><div class="stage" style="width:1920px;height:1080px">',
  '<h1 data-field="headline" onclick="evil()">Hi</h1>',
  // model script that posts a player action on load — the P0 vector
  '<script>parent.postMessage({type:"educms-action",action:{type:"open-url",target:"https://evil.example"}},"*")</script>',
  // trusted runtimes that MUST survive (nonce-stamped)
  '<script>/*EDUCMS-SHIM-V6*/var shim=1;</script>',
  '<script>/*VOS-CANVAS*/window.__VOS_CW=1920;</script>',
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
    expect(out).not.toContain('educms-action');
  });
  it('strips on* handler attributes (onclick, svg onload)', () => {
    expect(out).not.toMatch(/onclick|onload/i);
  });
  it('neutralizes javascript: URLs', () => {
    expect(out).not.toContain('javascript:alert');
  });
  it('strips meta refresh, <base>, and nested frames', () => {
    expect(out).not.toMatch(/http-equiv=["']?refresh/i);
    expect(out).not.toMatch(/<base|<iframe/i);
  });
  it('keeps the trusted baked runtimes (nonce-stamped)', () => {
    expect(out).toContain('var shim=1');
    expect(out).toContain('__VOS_CW=1920');
    const nonce = (out.match(/script-src 'nonce-([a-f0-9]+)'/) || [])[1];
    expect(nonce).toBeTruthy();
    expect(out).toContain(`<script nonce="${nonce}">/*EDUCMS-SHIM-V6*/`);
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
