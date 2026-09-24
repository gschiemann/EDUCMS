/**
 * designer-prompt.ts must stay loadable with NO runtime package on its import
 * graph (2026-09-23). apps/web/tests/fixtures/kept-pos-board.ts loads it FROM
 * SOURCE under the web Jest transformer, which cannot parse ESM packages: the
 * day `cheerio` reached the graph through designer-board-defects.ts, three web
 * suites (9 tests) went red in CI while the whole API suite stayed green.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = __dirname;
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/gm;

function graphOf(entry: string): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(file), spec);
        const candidate = ['.ts', '/index.ts'].map((ext) => base + ext).find((p) => fs.existsSync(p));
        if (candidate) walk(candidate);
      } else {
        bare.add(`${path.basename(file)} → ${spec}`);
      }
    }
  };
  walk(entry);
  return { files: [...seen].map((f) => path.relative(ROOT, f)), bare: [...bare] };
}

describe('designer-prompt.ts import graph', () => {
  it('reaches no runtime package — web tests load it from source', () => {
    const g = graphOf(path.join(ROOT, 'designer-prompt.ts'));
    expect(g.bare).toEqual([]);
    expect(g.files).not.toContain('designer-board-defects.ts');
    expect(g.files).toContain('designer-document-completeness.ts');
  });

  it('negative control: the defects module itself DOES reach cheerio', () => {
    const g = graphOf(path.join(ROOT, 'designer-board-defects.ts'));
    expect(g.bare).toContain('designer-board-defects.ts → cheerio');
  });
});

/**
 * The web test fixtures load these API modules FROM SOURCE too
 * (apps/web/tests/fixtures/designer-job.ts, kept-pos-board.ts). Their static
 * import graphs must never reach the cheerio-importing modules; a runtime
 * dependency on one of them goes through a lazy require() inside the caller
 * (designer-pos-binding.ts → designer-assets.ts, 2026-09-24).
 */
describe('modules the web fixtures load from source stay clear of cheerio', () => {
  const CHEERIO_MODULES = ['designer-board-defects.ts', 'menu-extractor.ts', 'designer-assets.ts'];
  const ROOTS = [
    path.join(ROOT, 'designer-pos-binding.ts'),
    path.join(ROOT, 'menu-binding.ts'),
    path.join(ROOT, '..', 'templates', 'designer-jobs', 'designer-job-request.ts'),
    path.join(ROOT, '..', 'templates', 'designer-jobs', 'designer-job-error.ts'),
  ];
  for (const root of ROOTS) {
    it(`${path.relative(path.join(ROOT, '..'), root)} does not statically reach a cheerio module`, () => {
      const g = graphOf(root);
      const hits = g.files.filter((f) => CHEERIO_MODULES.includes(path.basename(f)));
      expect(hits).toEqual([]);
      expect(g.bare).not.toEqual(expect.arrayContaining([expect.stringMatching(/→ cheerio$/)]));
    });
  }
});

