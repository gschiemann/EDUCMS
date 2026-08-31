import * as fs from 'fs';
import * as path from 'path';

/**
 * Every HTTP controller must mount under 'api/v1' — this codebase has NO
 * app.setGlobalPrefix(); each @Controller() decorator carries the full path
 * itself. That convention is invisible to unit tests (they call methods
 * directly) and to reviewers skimming a new controller, which is exactly how
 * GET /screens/fleet-pulse shipped mounted at the BARE path and 404'd for
 * the dashboard from its first deploy (2026-08-31): the sampler wrote
 * history, the chart showed "no data yet", and nothing was red anywhere.
 *
 * Allowlist, not loophole:
 *   - app.controller.ts     → root health/liveness paths, pre-date the
 *                             convention and are pinned by Railway config.
 *   - sso.controller.ts     → IdP-facing callback URLs registered with
 *                             external providers; moving them breaks SSO.
 * Add to the allowlist only with the same kind of external-contract reason,
 * in the same commit that documents it.
 */

const API_SRC = __dirname;

/** Bare or non-api/v1 @Controller() declarations allowed to exist. */
const ALLOWED_BARE = new Set(['app.controller.ts', 'sso.controller.ts']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('controller route prefixes', () => {
  it("every @Controller mounts under 'api/v1' (or sits on the documented allowlist)", () => {
    const offenders: string[] = [];
    for (const file of walk(API_SRC)) {
      const base = path.basename(file);
      if (ALLOWED_BARE.has(base)) continue;
      // Comments stripped first so prose ABOUT a decorator (docs, incident
      // notes) can never trip the guard — only real declarations count.
      const src = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Match every decorator: @Controller(), @Controller('x'), @Controller("x")
      const decls = [...src.matchAll(/@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g)];
      for (const m of decls) {
        const arg = m[1] ?? m[2] ?? '';
        if (!arg.startsWith('api/v1')) {
          offenders.push(`${path.relative(API_SRC, file)} → @Controller('${arg}')`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the allowlist names only files that still exist (no stale entries)', () => {
    const bases = new Set(walk(API_SRC).map((f) => path.basename(f)));
    for (const allowed of ALLOWED_BARE) {
      expect(bases.has(allowed)).toBe(true);
    }
  });
});
