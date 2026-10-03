import { readdirSync } from 'fs';
import { join } from 'path';
import { RESERVED_TENANT_SLUGS, isReservedTenantSlug } from '@cms/api-types';

/**
 * A tenant slug is the first path segment of its dashboard, so it shares one
 * namespace with every top-level URL the web origin serves. The list of words a
 * slug may never be lives in ONE place (`@cms/api-types` → tenant-slug.ts);
 * this spec is what keeps it honest. It walks the web app's own directories
 * from disk, so a new top-level route (or a new static folder under `public/`)
 * that is not reserved fails here instead of becoming a URL some organization
 * can claim by accident.
 */
const WEB = join(__dirname, '..', '..', '..', 'web');

/**
 * The URL segments a Next app directory contributes at the top level.
 *   [x] / [...x] — a dynamic segment (the tenant route `[schoolId]` itself):
 *                  not a fixed word, so nothing to reserve.
 *   _x           — a private folder, never routed (Next's own `_next` prefix is
 *                  reserved separately below).
 *   @x           — a parallel-route slot, not a URL segment.
 *   (x)          — a route group: invisible in the URL, so its children are
 *                  top-level segments.
 */
function topLevelRouteSegments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('[') || name.startsWith('_') || name.startsWith('@')) continue;
    if (name.startsWith('(') && name.endsWith(')')) {
      out.push(...topLevelRouteSegments(join(dir, name)));
      continue;
    }
    out.push(name);
  }
  return out;
}

/**
 * Everything under `public/` is served at `/<name>`. A directory always counts;
 * a file only matters when its whole name is something a slug could be (no dot,
 * so `favicon.ico` can never collide but an extension-less file could).
 */
function publicSegments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || /^[a-z0-9-]+$/.test(entry.name)) out.push(entry.name);
  }
  return out;
}

describe('RESERVED_TENANT_SLUGS covers every top-level URL the web origin serves', () => {
  const appRoutes = topLevelRouteSegments(join(WEB, 'src', 'app'));
  const publicFolders = publicSegments(join(WEB, 'public'));

  it('the scan really sees the app (negative control — an empty scan would pass vacuously)', () => {
    // Known routes that must be found, and the tenant route that must NOT be.
    for (const known of ['login', 'player', 'super', 'api', 'dashboard']) expect(appRoutes).toContain(known);
    expect(appRoutes).not.toContain('[schoolId]');
    expect(appRoutes.length).toBeGreaterThan(20);
    for (const known of ['templates', 'player', 'demo']) expect(publicFolders).toContain(known);
  });

  it('every app route directory is reserved', () => {
    const missing = appRoutes.filter((segment) => !isReservedTenantSlug(segment));
    expect(missing).toEqual([]);
  });

  it('every folder (and extension-less file) under public/ is reserved', () => {
    const missing = publicFolders.filter((segment) => !isReservedTenantSlug(segment));
    expect(missing).toEqual([]);
  });

  it('reserves what the build generates or the framework owns, which a clean checkout cannot show on disk', () => {
    // `public/locales/` is written by scripts/emit-locale-catalogs.cjs at dev /
    // build time and is gitignored, so the directory scan above never sees it in
    // CI — but the app fetches `/locales/<language>.json` from it.
    for (const word of ['locales', '_next', 'api']) expect(RESERVED_TENANT_SLUGS.has(word)).toBe(true);
  });

  it('matches case-insensitively and never reserves an ordinary organization label', () => {
    expect(isReservedTenantSlug('Player')).toBe(true);
    expect(isReservedTenantSlug('riverside-homes')).toBe(false);
    expect(isReservedTenantSlug('player-ecosystem')).toBe(false);
  });
});
