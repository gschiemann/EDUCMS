/**
 * Run the REAL `parsePdf` against a REAL PDF, in a plain Node process.
 *
 * WHY A CHILD PROCESS. `pdfjs-dist` v6 ships ESM only (`legacy/build/pdf.mjs`),
 * and the API compiles with `module: "nodenext"`, which PRESERVES the parser's
 * `await import()` as a true dynamic import — correct in production, and the
 * reason the PDF path works at runtime. Jest's CommonJS VM cannot service that
 * import without `--experimental-vm-modules`, and every route around it fails
 * for the same reason: Jest owns the module loader inside its sandbox, so even
 * `createRequire()` re-compiles the `.mjs` as CommonJS and dies on
 * `import.meta`. The repo already meets this wall elsewhere (see the comment in
 * `apps/api/src/proxy/render-pipeline.ts`, and the static `sharp` import in
 * `branding-scraper.service.ts`).
 *
 * The alternative — mocking pdf.js — would test a fiction. The audit's entire
 * point was what REAL pdf.js does with REAL bytes (it fills a column gutter
 * with a 346pt-wide zero-height whitespace run; no hand-written mock would have
 * predicted that). So the spec shells out here instead, and the pure half of
 * the pipeline (`buildImport`, `toDeviceItem`, `groupItemsIntoZones`) is
 * exercised directly, in-process.
 *
 * Usage:  node parse-pdf-in-child.mjs <file.pdf>
 * Output: the ParsedDocument as JSON on stdout. `media` is always [] for PDFs,
 *         so the document is fully serialisable.
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const parsersDir = join(here, '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

/**
 * Transpile the parser's TypeScript to CommonJS and load it from a temp
 * directory, resolving its relative imports against the same directory.
 * `pdfjs-dist` is resolved from the real `apps/api/node_modules` because the
 * temp module's `paths` are seeded from the source directory.
 */
function loadParserModules() {
  const names = ['types', 'units', 'pdf-parser'];
  const dir = mkdtempSync(join(tmpdir(), 'venueos-import-parsers-'));
  const sources = {};
  for (const name of names) {
    const out = ts.transpileModule(
      readFileSync(join(parsersDir, `${name}.ts`), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: `${name}.ts`,
      },
    ).outputText;
    const file = join(dir, `${name}.js`);
    writeFileSync(file, out);
    sources[name] = file;
  }

  const cache = {};
  const loadOne = (name) => {
    if (cache[name]) return cache[name];
    const file = sources[name];
    const mod = new Module(file, null);
    mod.filename = file;
    // Resolve bare specifiers (pdfjs-dist) against the real source tree.
    mod.paths = Module._nodeModulePaths(parsersDir);
    cache[name] = mod.exports;
    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
      const local = request.replace(/^\.\//, '');
      if (sources[local]) return loadOne(local);
      return originalRequire(request);
    };
    mod._compile(readFileSync(file, 'utf8'), file);
    cache[name] = mod.exports;
    return mod.exports;
  };
  return loadOne('pdf-parser');
}

const target = process.argv[2];
if (!target) {
  process.stderr.write('usage: parse-pdf-in-child.mjs <file.pdf>\n');
  process.exit(2);
}

const { parsePdf } = loadParserModules();
const doc = await parsePdf(readFileSync(target));
process.stdout.write(JSON.stringify(doc));
