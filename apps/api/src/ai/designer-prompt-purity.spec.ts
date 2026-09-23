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
