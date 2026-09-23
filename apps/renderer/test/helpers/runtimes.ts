/**
 * Load the product's OWN board runtimes straight from source — the API's fit
 * engine (designer-edit-shim.ts) and the web's srcdoc wrapper with its
 * VOS-STAGE-SCALE runtime and CSP (designer-safe-srcdoc.ts) — so the
 * integration test renders the document a screen really gets, not a copy
 * that could drift. Transpiled with TypeScript; nothing else is executed.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { repoRoot } from './env.js';

export const EDIT_SHIM_TS = path.join(repoRoot(), 'apps', 'api', 'src', 'ai', 'designer-edit-shim.ts');
export const SAFE_SRCDOC_TS = path.join(repoRoot(), 'apps', 'web', 'src', 'lib', 'designer-safe-srcdoc.ts');

export function runtimesAvailable(): boolean {
  return fs.existsSync(EDIT_SHIM_TS) && fs.existsSync(SAFE_SRCDOC_TS);
}

function loadTsModule(file: string, stubs: Record<string, unknown> = {}): Record<string, unknown> {
  const source = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (id in stubs) return stubs[id];
    throw new Error(`${path.basename(file)} requires ${id}, which this loader does not provide`);
  };
  new Function('exports', 'require', 'module', js)(mod.exports, req, mod);
  return mod.exports;
}

/** Board HTML → the document a screen renders: fit engine baked in, then the srcdoc wrap (CSP + stage scale). */
export function assembleLikeTheProduct(html: string, width: number, height: number): string {
  const shim = loadTsModule(EDIT_SHIM_TS) as { injectDesignerLayoutEngine(h: string, w?: number, hh?: number): string };
  const srcdoc = loadTsModule(SAFE_SRCDOC_TS, { './csp-nonce': { readCspNonce: () => null } }) as {
    buildSafeDesignerSrcdoc(h: string): string;
  };
  return srcdoc.buildSafeDesignerSrcdoc(shim.injectDesignerLayoutEngine(html, width, height));
}
