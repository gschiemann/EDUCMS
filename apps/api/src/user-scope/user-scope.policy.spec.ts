/**
 * USER SCOPING — the route policy for screen-scoped people, pinned against the
 * REAL route inventory. Every controller under apps/api/src is parsed (same AST
 * approach as security/route-guard-inventory.spec.ts) and every JWT route's
 * verdict is computed, so a new route is visible here the day it lands — and
 * because the policy is default-deny, it is refused until someone decides.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  SCOPED_ROUTE_RULES,
  bodyTargets,
  decideScopedRoute,
  isScopableRole,
  isStaleLocationExemptPath,
  normalizePath,
  parseIdList,
  rowTargetInScope,
  targetsInScope,
} from './user-scope.policy';

const API_SRC = path.resolve(__dirname, '..');
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const strip = (s: string) => s.replace(/^['"`]|['"`]$/g, '');

interface Route {
  method: string;
  path: string;
  where: string;
}

function jwtRoutes(): Route[] {
  const out: Route[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.controller\.ts$/.test(e.name)) {
        const src = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (n: ts.Node): void => {
          if (ts.isClassDeclaration(n)) {
            let prefix = '';
            let classGuards = '';
            for (const d of ts.getDecorators(n) ?? []) {
              const ex = d.expression;
              if (!ts.isCallExpression(ex)) continue;
              const name = ex.expression.getText();
              if (name === 'Controller' && ex.arguments[0]) prefix = strip(ex.arguments[0].getText());
              if (name === 'UseGuards') classGuards += ex.arguments.map((a) => a.getText()).join(',');
            }
            for (const m of n.members) {
              if (!ts.isMethodDeclaration(m)) continue;
              const ds = (ts.getDecorators(m) ?? []).map((d) => d.expression).filter(ts.isCallExpression);
              const r = ds.find((d) => ROUTE_DECORATORS.has(d.expression.getText()));
              if (!r) continue;
              const guards = classGuards + ds.filter((d) => d.expression.getText() === 'UseGuards').map((d) => d.getText()).join(',');
              if (!/JwtAuthGuard/.test(guards)) continue;
              const sub = r.arguments[0] ? strip(r.arguments[0].getText()) : '';
              out.push({
                method: r.expression.getText().toUpperCase(),
                path: '/' + [prefix, sub].filter(Boolean).join('/'),
                where: `${path.relative(API_SRC, p)}#${m.name.getText()}`,
              });
            }
          }
          ts.forEachChild(n, visit);
        };
        visit(src);
      }
    }
  };
  walk(API_SRC);
  return out;
}

/** Put a concrete value in every `:param` so the route can be decided like a real request. */
const concrete = (p: string) => p.replace(/:([A-Za-z]+)/g, 'x-$1');
const verdict = (r: Route) => decideScopedRoute(r.method, concrete(r.path)).check.kind;

describe('user-scope policy — the real route inventory', () => {
  const routes = jwtRoutes();

  it('finds the JWT route surface (negative control: the inventory is not empty)', () => {
    expect(routes.length).toBeGreaterThan(400);
    expect(routes.some((r) => r.path === '/api/v1/screens' && r.method === 'GET')).toBe(true);
  });

  it('refuses people, settings, billing, audit, support access, keys, integrations, sports, fleet roll-ups', () => {
    const closedPrefixes = [
      '/api/v1/users/:id', // every per-person admin route
      '/api/v1/tenants/me',
      '/api/v1/tenants/children',
      '/api/v1/tenants/panic-settings',
      '/api/v1/billing',
      '/api/v1/audit',
      '/api/v1/support-access',
      '/api/v1/api-keys',
      '/api/v1/webhooks',
      '/api/v1/integrations',
      '/api/v1/sports',
      '/api/v1/floor-plans',
      '/api/v1/panic-content',
      '/api/v1/analytics',
      '/api/v1/stats',
      '/api/v1/pos',
      '/api/v1/streaming',
      '/api/v1/invites',
      '/api/v1/super',
    ];
    const leaks = routes.filter(
      (r) => closedPrefixes.some((p) => r.path === p || r.path.startsWith(p + '/')) && verdict(r) !== 'deny',
    );
    expect(leaks.map((r) => `${r.method} ${r.path} (${r.where}) → ${verdict(r)}`)).toEqual([]);
    // GET/POST /users (list + create) are refused too.
    expect(decideScopedRoute('GET', '/api/v1/users').check.kind).toBe('deny');
    expect(decideScopedRoute('POST', '/api/v1/users').check.kind).toBe('deny');
  });

  it('never lets a route that names a screen through unchecked (emergency alerts excepted by owner decision)', () => {
    const screenRoutes = routes.filter(
      (r) => (/\/screens\/:[A-Za-z]+/.test(r.path) || /:screenId/.test(r.path)) && !r.path.startsWith('/api/v1/emergency'),
    );
    expect(screenRoutes.length).toBeGreaterThan(20);
    const unchecked = screenRoutes.filter((r) => verdict(r) === 'pass' || verdict(r) === 'filter');
    expect(unchecked.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('owner decision: every /emergency route passes untouched', () => {
    const em = routes.filter((r) => r.path.startsWith('/api/v1/emergency'));
    expect(em.length).toBeGreaterThan(10);
    expect(em.filter((r) => verdict(r) !== 'pass').map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('screen-group structure is the location admin\'s: only the list is open', () => {
    const groups = routes.filter((r) => r.path.startsWith('/api/v1/screen-groups'));
    for (const r of groups) {
      expect([r.method, r.path, verdict(r)]).toEqual([r.method, r.path, r.method === 'GET' && r.path === '/api/v1/screen-groups' ? 'filter' : 'deny']);
    }
  });

  it('every rule in the table matches at least one real route (no dead rules)', () => {
    const dead = SCOPED_ROUTE_RULES.filter(
      (rule) => !routes.some((r) => decideScopedRoute(r.method, concrete(r.path)).rule === rule),
    ).map((r) => `${r.methods} ${r.pattern}`);
    expect(dead).toEqual([]);
  });

  it('prints the verdict count by kind (visible in CI output)', () => {
    const counts: Record<string, number> = {};
    for (const r of routes) counts[verdict(r)] = (counts[verdict(r)] ?? 0) + 1;
    expect(counts.deny).toBeGreaterThan(counts.pass);
  });
});

describe('user-scope policy — decisions', () => {
  it.each([
    ['GET', '/api/v1/screens', 'filter'],
    ['GET', '/api/v1/screens?x=1', 'filter'],
    ['PUT', '/api/v1/screens/s1', 'screen'],
    ['DELETE', '/api/v1/screens/s1', 'screen'],
    ['POST', '/api/v1/screens/s1/refresh-web', 'screen'],
    ['POST', '/api/v1/screens/s1/display-control', 'screen'],
    ['PUT', '/api/v1/screens/s1/emergency-content', 'deny'],
    ['POST', '/api/v1/screens/refresh-web', 'deny'],
    ['POST', '/api/v1/screens/force-update', 'deny'],
    ['POST', '/api/v1/screens/pair', 'deny'],
    ['GET', '/api/v1/screens/fleet', 'deny'],
    ['GET', '/api/v1/screens/panel-target', 'pass'],
    ['POST', '/api/v1/schedules', 'body'],
    ['PUT', '/api/v1/schedules/x', 'schedule'],
    ['PUT', '/api/v1/schedules/x/toggle', 'schedule'],
    ['DELETE', '/api/v1/schedules/x', 'schedule'],
    ['GET', '/api/v1/playlists/p1', 'pass'],
    ['PUT', '/api/v1/playlists/p1', 'playlist'],
    ['DELETE', '/api/v1/playlists/p1', 'playlist'],
    ['PUT', '/api/v1/playlists/p1/active', 'playlist'],
    ['DELETE', '/api/v1/playlists/p1/screens/s1', 'screen'],
    ['POST', '/api/v1/playlists/p1/publish-to-fleet', 'deny'],
    ['POST', '/api/v1/assets/emergency-upload', 'deny'],
    ['GET', '/api/v1/assets', 'pass'],
    ['POST', '/api/v1/ai/key', 'deny'],
    ['GET', '/api/v1/ai/key', 'pass'],
    ['GET', '/api/v1/users/me', 'pass'],
    ['GET', '/api/v1/tenants/accessible', 'pass'],
    ['POST', '/api/v1/emergency/trigger', 'pass'],
    ['GET', '/api/v1/some/new/route', 'deny'],
  ])('%s %s → %s', (method, p, kind) => {
    expect(decideScopedRoute(method, p).check.kind).toBe(kind);
  });

  it('captures the screen id from the path', () => {
    expect(decideScopedRoute('POST', '/api/v1/screens/abc-123/refresh-web').params).toEqual({ id: 'abc-123' });
    expect(decideScopedRoute('DELETE', '/api/v1/playlists/p/screens/s9').params).toEqual({ id: 'p', screenId: 's9' });
  });

  it('only location roles are scopable', () => {
    expect(['SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'].every(isScopableRole)).toBe(true);
    expect(isScopableRole('DISTRICT_ADMIN')).toBe(false);
    expect(isScopableRole('SUPER_ADMIN')).toBe(false);
    expect(isScopableRole(undefined)).toBe(false);
  });

  it('stale-location exemptions are only sign-out / who-am-i / the switcher', () => {
    expect(isStaleLocationExemptPath('/api/v1/auth/logout')).toBe(true);
    expect(isStaleLocationExemptPath('/api/v1/users/me')).toBe(true);
    expect(isStaleLocationExemptPath('/api/v1/tenants/switch')).toBe(true);
    expect(isStaleLocationExemptPath('/api/v1/screens')).toBe(false);
    expect(isStaleLocationExemptPath('/api/v1/users/me/../x')).toBe(false);
  });

  it('body targets and row targets', () => {
    const scope = { screenIds: ['s1', 's2'], groupIds: ['g1'] };
    expect(bodyTargets({ screenId: 's1', screenGroupId: 'g1', screenIds: ['s2', 7] })).toEqual({ screenIds: ['s1', 's2'], groupIds: ['g1'] });
    expect(targetsInScope(scope, { screenIds: ['s1'], groupIds: [] })).toBe(true);
    expect(targetsInScope(scope, { screenIds: ['s3'], groupIds: [] })).toBe(false);
    expect(targetsInScope(scope, { screenIds: [], groupIds: ['g2'] })).toBe(false);
    expect(rowTargetInScope(scope, { screenId: 's2' })).toBe(true);
    expect(rowTargetInScope(scope, { screenGroupId: 'g1' })).toBe(true);
    expect(rowTargetInScope(scope, { screenGroupId: 'g9' })).toBe(false);
    expect(rowTargetInScope(scope, {})).toBe(false);
  });

  it('normalizes paths and validates id lists', () => {
    expect(normalizePath('/api/v1/screens/?a=b')).toBe('/api/v1/screens');
    expect(parseIdList(['a', 'a', ' b '], 'x')).toEqual(['a', 'b']);
    expect(() => parseIdList('a', 'x')).toThrow();
    expect(() => parseIdList([''], 'x')).toThrow();
  });
});
