/**
 * DEVICE PRINCIPALS ON JwtAuthGuard-ONLY ROUTES (2026-11-16).
 *
 * JwtAuthGuard accepts a screen's device JWT and builds `req.user` with
 * `kind: 'device'` (and the live screen's tenant, DeviceIdentityInterceptor).
 * A route guarded by JwtAuthGuard and carrying no `@RequireRoles` therefore
 * answers a screen credential exactly as it answers a person, unless the route
 * itself decides otherwise.
 *
 * This file is the decision table. It SCANS every controller for routes that
 * are JwtAuthGuard-guarded with no `@RequireRoles` (class or method) and
 * requires each one to appear below as:
 *   - `blocked`  — tenant admin data no screen needs; carries
 *                  `DenyDevicePrincipalGuard` (403 for `kind: 'device'`);
 *   - `player`   — the player or the APK calls it; the cited call site must
 *                  still contain the path, and the route must NOT carry the
 *                  guard;
 *   - `open`     — not tenant admin data, or the handler already refuses a
 *                  device / only touches the caller's own user row; reason given.
 * Add such a route and this file fails until you decide.
 *
 * SDW-01 (2026-11-23) — and a second decision per route: does it answer a
 * screen that has NO tenant yet (unpaired)? A device principal whose live
 * screen row has no tenant is refused unless the route opts in.
 * `UNPAIRED_ALLOWED` below is the list of routes that opt in; everything else
 * on this surface is refused by DeviceIdentityInterceptor before its handler
 * runs, and the bottom of this file proves it route by route against the
 * real interceptor.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { lastValueFrom, of } from 'rxjs';
import { DenyDevicePrincipalGuard } from '../auth/deny-device-principal.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DeviceIdentityInterceptor } from '../security/device-identity.interceptor';
import { ALLOW_UNPAIRED_DEVICE_KEY } from '../security/allow-unpaired-device.decorator';
import { deviceJwtSecretRing } from '../security/key-ring';
import { invalidateDeviceCredentialCache } from './device-auth';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
// The SDW-01 block loads every device-reachable controller to read its real
// handler; the branding controller pulls in an ESM-only sanitizer jest cannot
// parse. Nothing here sanitizes anything (same stub as the role matrix).
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (raw: string) => String(raw) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require('typescript');

const API_SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(API_SRC, '..', '..', '..');

type Decision =
  | { kind: 'blocked' }
  | { kind: 'player'; callSite: string; needle: string }
  | { kind: 'open'; why: string };

/** `METHOD path` → decision. Paths as the controller declares them. */
const TABLE: Record<string, Decision> = {
  // ── blocked: tenant admin data, no player / APK call site ────────────────
  'GET /api/v1/notifications': { kind: 'blocked' },
  'POST /api/v1/notifications/:id/read': { kind: 'blocked' },
  'POST /api/v1/notifications/read-all': { kind: 'blocked' },
  'GET /api/v1/notifications/alert-emails': { kind: 'blocked' },
  'PUT /api/v1/notifications/alert-emails': { kind: 'blocked' },
  'GET /api/v1/license/me': { kind: 'blocked' },
  'GET /api/v1/license/current': { kind: 'blocked' },
  'GET /api/v1/tenants': { kind: 'blocked' },
  'GET /api/v1/tenants/accessible': { kind: 'blocked' },

  // ── player: kept, with the call site that needs it ───────────────────────
  'POST /api/v1/analytics/touch-events': { kind: 'player', callSite: 'apps/web/src/app/player/page.tsx', needle: '/api/v1/analytics/touch-events' },
  'GET /api/v1/assets/:id/playback': { kind: 'player', callSite: 'apps/web/src/components/player/TouchOverlay.tsx', needle: '/api/v1/assets/${encodeURIComponent(target)}/playback' },
  'GET /api/v1/templates/:id/playback': { kind: 'player', callSite: 'apps/web/src/app/player/page.tsx', needle: '/api/v1/templates/${encodeURIComponent(targetTemplateId)}/playback' },
  'GET /api/v1/screens/:id/manifest': { kind: 'player', callSite: 'apps/web/src/app/player/page.tsx', needle: '/api/v1/screens/${screenId}/manifest' },
  'GET /api/v1/emergency/messages': { kind: 'player', callSite: 'apps/web/src/app/player/page.tsx', needle: '/api/v1/emergency/messages' },
  'GET /api/v1/emergency/status': { kind: 'player', callSite: 'apps/web/src/components/player/EmergencyOverlay.tsx', needle: '/emergency/status' },
  'POST /api/v1/tenants/me/usb-ingest/screens/:screenId/event': { kind: 'player', callSite: 'apps/player/app/src/main/java/com/educms/player/usb/UsbAutoImport.kt', needle: '/api/v1/tenants/me/usb-ingest/screens/' },
  'GET /api/v1/integrations/social/posts': { kind: 'player', callSite: 'apps/web/src/lib/social/device-social.ts', needle: '/api/v1/integrations/social/posts' },
  'GET /api/v1/integrations/google-reviews/reviews': { kind: 'player', callSite: 'apps/web/src/lib/reviews/google-reviews-client.ts', needle: '/integrations/google-reviews/reviews' },
  'GET /api/v1/integrations/google-reviews/status': { kind: 'player', callSite: 'apps/web/src/lib/reviews/google-reviews-client.ts', needle: '/integrations/google-reviews/status' },
  'POST /api/v1/proxy/render-capability': { kind: 'player', callSite: 'apps/web/src/lib/render-capability.ts', needle: '/proxy/render-capability' },
  'GET /api/v1/geocode': { kind: 'player', callSite: 'apps/web/src/lib/geocode.ts', needle: '/api/v1/geocode' },
  'GET /api/v1/branding/me': { kind: 'player', callSite: 'apps/web/src/hooks/use-api.ts', needle: "'/branding/me'" },

  // ── open: not tenant admin data, or the handler already decides ──────────
  'GET /api/v1/geocode/reverse': { kind: 'open', why: 'public geocoding lookup; no tenant data' },
  'POST /api/v1/integrations/google-reviews/places/search': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/proxy/site-check': { kind: 'open', why: 'SSRF-guarded reachability check of a URL; no tenant data' },
  'GET /api/v1/feature-flags': { kind: 'open', why: 'global feature flags; no tenant data' },
  'GET /api/v1/hardware/catalog': { kind: 'open', why: 'static product catalog' },
  'GET /api/v1/license/tiers': { kind: 'open', why: 'static price catalog' },
  'GET /api/v1/billing/status': { kind: 'open', why: 'whether the deploy has Stripe configured; no tenant data' },
  'GET /api/v1/billing/summary': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/branding/derive-palette': { kind: 'open', why: 'pure colour computation; no tenant data' },
  'POST /api/v1/tenants/switch': { kind: 'open', why: 'role-gated in the handler; a device has no role and is refused' },
  'GET /api/v1/users/me': { kind: 'open', why: "self-lookup by the principal's own id; a screen id is no user row" },
  'PUT /api/v1/users/me': { kind: 'open', why: "self-update by the principal's own id; a screen id is no user row" },
  'POST /api/v1/users/me/terms': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/change-password': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/complete-setup/email-code': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/complete-setup': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/refresh': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/logout': { kind: 'open', why: "ends the caller's own session only" },
  'POST /api/v1/auth/session/issue': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/verify-email/send': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/verify-email/confirm': { kind: 'open', why: 'handler refuses kind=device itself' },
  'GET /api/v1/auth/mfa/status': { kind: 'open', why: "the caller's own user row; a screen id is no user row" },
  'POST /api/v1/auth/mfa/enroll': { kind: 'open', why: "the caller's own user row; a screen id is no user row" },
  'POST /api/v1/auth/mfa/verify': { kind: 'open', why: "the caller's own user row; a screen id is no user row" },
  'POST /api/v1/auth/mfa/disable': { kind: 'open', why: "the caller's own user row; a screen id is no user row" },
  'POST /api/v1/auth/mfa/backup-codes': { kind: 'open', why: "the caller's own user row; a screen id is no user row" },
  'GET /api/v1/auth/passkeys': { kind: 'open', why: "the caller's own passkeys; a screen id is no user row" },
  'POST /api/v1/auth/passkeys/register/options': { kind: 'open', why: 'handler refuses kind=device itself' },
  // 2026-11-16 (#319): the panic-phone enroll refuses a screen credential at
  // panic-device.controller.ts (`actor?.kind === 'device'` → 403) and needs a
  // full, recent sign-in besides.
  'POST /api/v1/panic-device/enroll': { kind: 'open', why: 'handler refuses kind=device itself' },
  'POST /api/v1/auth/passkeys/register/verify': { kind: 'open', why: "the caller's own passkeys; a screen id is no user row" },
  'PATCH /api/v1/auth/passkeys/:id': { kind: 'open', why: "the caller's own passkeys; a screen id is no user row" },
  'DELETE /api/v1/auth/passkeys/:id': { kind: 'open', why: "the caller's own passkeys; a screen id is no user row" },
};

// ── SDW-01: the routes on this surface that answer an UNPAIRED screen ─────
//
// A screen with no tenant holds a valid device credential (registration mints
// one so the pairing splash can heartbeat, take OTA updates and report its
// orientation — those calls use `verifyDeviceForScreen(…, { allowUnpaired })`
// and never reach this surface). Here, exactly these routes carry
// `@AllowUnpairedDevice()`. Each one's handler reads the screen's own row or
// answers "nothing" without a tenant; none puts `req.user.tenantId` into a
// query. Every other route is refused in DeviceIdentityInterceptor.
//
// `callSite` / `needle`: the client that calls the route with the credential
// the screen holds while it is unpaired.

interface UnpairedDecision {
  why: string;
  callSite?: string;
  needle?: string;
}

const UNPAIRED_ALLOWED: Record<string, UnpairedDecision> = {
  'GET /api/v1/screens/:id/manifest': {
    why:
      "self-scoped to the screen's own row (`sub` must equal `:id`); with no tenant it carries no emergency " +
      'block and no tenant content. The APK native alert watch polls it with the stored registration token ' +
      'while the panel is in standby on the pairing splash, and the page keeps polling it while it confirms ' +
      'an "unpaired" answer before leaving content on the glass.',
    callSite: 'apps/player/app/src/main/java/com/educms/player/alertwatch/NativeAlertWatch.kt',
    needle: '/api/v1/screens/${target.screenId}/manifest',
  },
  'GET /api/v1/emergency/messages': {
    why:
      "life-safety poll; reads the screen's own row and answers INACTIVE when it has no tenant. The overlay " +
      'and the pushed-message reconcile keep polling it with the credential the page holds, and this fix ' +
      'leaves the emergency path exactly as it was.',
    callSite: 'apps/web/src/components/player/EmergencyOverlay.tsx',
    needle: '`${apiUrl}/emergency/messages`',
  },
  // No call site, on purpose. Kept DELIBERATELY, not on evidence of a caller:
  // no client, current or cached, sends this route a device credential. The
  // overlay sends its device token to /emergency/messages and reaches
  // /emergency/status only with the session cookie (no Authorization header,
  // which JwtAuthGuard answers before any interceptor); the bundles from
  // before the device poll existed sent the cookie too; the APK never calls
  // it. Removing the marker would change an emergency route's answer, which
  // is life-safety CHANGE class, for a caller that does not exist.
  'GET /api/v1/emergency/status': {
    why:
      'life-safety read; answers `{ active: [], tenantId: null }` before any query when the principal has no ' +
      'tenant. Kept deliberately so the emergency controller answers every principal exactly as it did; no ' +
      'client, current or service-worker-cached, sends it a device credential (see the comment above).',
  },
};

// ── the scanner ──────────────────────────────────────────────────────────

interface FoundRoute {
  key: string;
  file: string;
  className: string;
  method: string;
  /** `DenyDevicePrincipalGuard` named in a class- or method-level @UseGuards. */
  deniesInSource: boolean;
  /** `@AllowUnpairedDevice()` on the method (SDW-01). */
  allowsUnpairedInSource: boolean;
  /** `JwtAuthGuard` named in a class- or method-level @UseGuards. */
  jwt: boolean;
  /** `@RequireRoles` on the class or the method. */
  roles: boolean;
}

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function decoratorsOf(node: any): Array<{ name: string; args: string[] }> {
  const ds = ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : [];
  return ds.map((d: any) => {
    const e = d.expression;
    const call = ts.isCallExpression(e);
    return {
      name: call ? e.expression.getText() : e.getText(),
      args: call ? e.arguments.map((a: any) => a.getText()) : [],
    };
  });
}

function scanJwtOnlyRoutes(): FoundRoute[] {
  return scanRoutes().filter((r) => r.jwt && !r.roles);
}

/** Every HTTP route in every controller, with its guard / role / marker facts. */
function scanRoutes(): FoundRoute[] {
  const found: FoundRoute[] = [];
  for (const file of walk(API_SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('@Controller')) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    sf.forEachChild((n: any) => {
      if (!ts.isClassDeclaration(n)) return;
      const cd = decoratorsOf(n);
      const ctrl = cd.find((d) => d.name === 'Controller');
      if (!ctrl) return;
      const base = (ctrl.args[0] || "''").replace(/['"`]/g, '');
      const classJwt = cd.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.includes('JwtAuthGuard')));
      const classRoles = cd.some((d) => d.name === 'RequireRoles');
      for (const m of n.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        const md = decoratorsOf(m);
        const http = md.find((d) => HTTP.has(d.name));
        if (!http) continue;
        const jwt = classJwt || md.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.includes('JwtAuthGuard')));
        const roles = classRoles || md.some((d) => d.name === 'RequireRoles');
        const denies = [...cd, ...md].some(
          (d) => d.name === 'UseGuards' && d.args.some((a) => a.includes('DenyDevicePrincipalGuard')),
        );
        const sub = (http.args[0] || "''").replace(/['"`]/g, '');
        found.push({
          key: `${http.name.toUpperCase()} /${[base, sub].filter(Boolean).join('/')}`,
          file,
          className: n.name.getText(),
          method: m.name.getText(),
          deniesInSource: denies,
          allowsUnpairedInSource: md.some((d) => d.name === 'AllowUnpairedDevice'),
          jwt,
          roles,
        });
      }
    });
  }
  return found;
}

function classOf(found: FoundRoute): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(found.file)[found.className];
}

function guardsOn(found: FoundRoute): unknown[] {
  const cls = classOf(found);
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, cls) || [];
  const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, cls.prototype[found.method]) || [];
  return [...classGuards, ...methodGuards];
}

const routes = scanJwtOnlyRoutes();

describe('JwtAuthGuard-only routes — every one has a device-principal decision', () => {
  it('the scanner finds the routes at all (guards the scanner itself)', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.map((r) => r.key)).toContain('GET /api/v1/notifications');
    expect(routes.map((r) => r.key)).toContain('GET /api/v1/screens/:id/manifest');
  });

  it('every scanned route appears in the table', () => {
    const missing = routes.map((r) => r.key).filter((k) => !TABLE[k]);
    expect(missing).toEqual([]);
  });

  it('every table row still exists in the code (no stale rows)', () => {
    const keys = new Set(routes.map((r) => r.key));
    expect(Object.keys(TABLE).filter((k) => !keys.has(k))).toEqual([]);
  });
});

describe('blocked routes carry DenyDevicePrincipalGuard', () => {
  for (const r of routes.filter((x) => TABLE[x.key]?.kind === 'blocked')) {
    it(`${r.key} → refuses a device principal`, () => {
      expect(r.deniesInSource).toBe(true);
      // …and the decorator really registered the guard on the route.
      expect(guardsOn(r)).toContain(DenyDevicePrincipalGuard);
    });
  }
});

describe('player / open routes do NOT carry it', () => {
  for (const r of routes.filter((x) => TABLE[x.key] && TABLE[x.key].kind !== 'blocked')) {
    it(`${r.key} stays reachable by a screen credential`, () => {
      expect(r.deniesInSource).toBe(false);
    });
  }
  it('the player call site of every kept player route still contains the path', () => {
    const stale: string[] = [];
    for (const [key, d] of Object.entries(TABLE)) {
      if (d.kind !== 'player') continue;
      const src = fs.readFileSync(path.join(REPO, d.callSite), 'utf8');
      if (!src.includes(d.needle)) stale.push(`${key} — ${d.callSite}`);
    }
    expect(stale).toEqual([]);
  });
  it('the player\'s help request stays on the device-authenticated public route', () => {
    const page = fs.readFileSync(path.join(REPO, 'apps/web/src/app/player/page.tsx'), 'utf8');
    expect(page).toContain('/api/v1/notifications/help');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NotificationsPublicController } = require('../notifications/notifications.controller');
    expect(Reflect.getMetadata(GUARDS_METADATA, NotificationsPublicController) || []).not.toContain(DenyDevicePrincipalGuard);
  });
});

describe('DenyDevicePrincipalGuard', () => {
  const ctx = (user: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
  const guard = new DenyDevicePrincipalGuard();

  it('403s a device principal', () => {
    expect(() => guard.canActivate(ctx({ id: 'screen-1', kind: 'device', tenantId: 't' }))).toThrow(ForbiddenException);
    try {
      guard.canActivate(ctx({ id: 'screen-1', kind: 'device' }));
    } catch (e: any) {
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse().code).toBe('DEVICE_PRINCIPAL_NOT_ALLOWED');
    }
  });

  it('admits a person and an API key unchanged', () => {
    expect(guard.canActivate(ctx({ id: 'u1', role: 'SCHOOL_ADMIN', tenantId: 't' }))).toBe(true);
    expect(guard.canActivate(ctx({ id: 'k1', kind: 'api-key', tenantId: 't' }))).toBe(true);
  });
});


// ─────────────────────────────────────────────────────────────────────────
// SDW-01 (2026-11-23) — a device principal must belong to a tenant.
// ─────────────────────────────────────────────────────────────────────────

const SCREEN_ID = 'screen-sdw01';
const PAIRED_TENANT = 'tenant-paired';

/** Exactly what `POST /screens/register` mints for a brand-new screen: no tenant, not unproven. */
const registrationToken = () =>
  new JwtService({ secret: deviceJwtSecretRing().primary }).sign(
    { sub: SCREEN_ID, deviceId: SCREEN_ID, kind: 'device', ep: 0 },
    { expiresIn: '15m' },
  );
/** A paired screen's credential. */
const pairedToken = () =>
  new JwtService({ secret: deviceJwtSecretRing().primary }).sign(
    { sub: SCREEN_ID, deviceId: SCREEN_ID, kind: 'device', ep: 0, tenantId: PAIRED_TENANT },
    { expiresIn: '180d' },
  );

const screenRow = (tenantId: string | null) => ({
  id: SCREEN_ID,
  tenantId,
  screenGroupId: null,
  status: tenantId ? 'ONLINE' : 'PENDING',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
});

const httpMethodOf = (key: string) => key.split(' ')[0];

/** The request JwtAuthGuard leaves behind for a device bearer token. */
function guardedRequest(token: string, key: string) {
  return {
    method: httpMethodOf(key),
    headers: { authorization: `Bearer ${token}` },
    user: { id: SCREEN_ID, sub: SCREEN_ID, kind: 'device', tenantId: undefined as string | undefined },
  };
}

/** The ExecutionContext Nest builds for this route's real handler. */
function routeContext(r: FoundRoute, req: unknown) {
  const cls = classOf(r);
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => cls.prototype[r.method],
    getClass: () => cls,
  } as any;
}

function interceptorWith(tenantId: string | null) {
  return new DeviceIdentityInterceptor({
    client: { screen: { findUnique: jest.fn().mockResolvedValue(screenRow(tenantId)) } },
  } as any);
}

const ran = { handle: () => of('handler-ran') } as any;

describe('SDW-01 — which routes answer a screen with no tenant', () => {
  const allRoutes = scanRoutes();

  it('exactly the decided routes carry @AllowUnpairedDevice(), anywhere in the API', () => {
    const marked = allRoutes.filter((r) => r.allowsUnpairedInSource).map((r) => r.key).sort();
    expect(marked).toEqual(Object.keys(UNPAIRED_ALLOWED).sort());
  });

  it('…and the decorator really registered the marker on each of them', () => {
    for (const r of allRoutes.filter((x) => x.allowsUnpairedInSource)) {
      expect(Reflect.getMetadata(ALLOW_UNPAIRED_DEVICE_KEY, classOf(r).prototype[r.method])).toBe(true);
    }
  });

  it('every allowed route is a kept device route of this surface, not a blocked one', () => {
    for (const key of Object.keys(UNPAIRED_ALLOWED)) {
      expect(routes.map((r) => r.key)).toContain(key);
      expect(TABLE[key]?.kind).toBe('player');
    }
  });

  it('the cited unpaired call sites still contain the path', () => {
    const stale: string[] = [];
    for (const [key, d] of Object.entries(UNPAIRED_ALLOWED)) {
      if (!d.callSite || !d.needle) continue;
      const src = fs.readFileSync(path.join(REPO, d.callSite), 'utf8');
      if (!src.includes(d.needle)) stale.push(`${key} — ${d.callSite}`);
    }
    expect(stale).toEqual([]);
  });
});

describe('SDW-01 — an unpaired screen’s credential, route by route, through the real interceptor', () => {
  beforeEach(() => invalidateDeviceCredentialCache());

  // `blocked` routes never get this far: DenyDevicePrincipalGuard 403s every
  // device principal before any interceptor runs (asserted above).
  const reachable = routes.filter((r) => TABLE[r.key] && TABLE[r.key].kind !== 'blocked');

  it('covers the whole device-reachable surface', () => {
    expect(reachable.length).toBeGreaterThan(30);
  });

  for (const r of reachable) {
    const allowed = !!UNPAIRED_ALLOWED[r.key];
    it(`${r.key} → ${allowed ? 'ADMITS' : 'REFUSES'} an unpaired screen`, async () => {
      const req = guardedRequest(registrationToken(), r.key);
      const run = lastValueFrom(await interceptorWith(null).intercept(routeContext(r, req), ran));
      if (allowed) {
        await expect(run).resolves.toBe('handler-ran');
        expect(req.user.tenantId).toBeUndefined();
      } else {
        await expect(run).rejects.toMatchObject({ status: 401, response: { code: 'DEVICE_SCREEN_UNPAIRED' } });
      }
    });
  }

  it('a PAIRED screen is admitted on every one of them, with its live tenant (no fleet change)', async () => {
    const refused: string[] = [];
    for (const r of reachable) {
      invalidateDeviceCredentialCache();
      const req = guardedRequest(pairedToken(), r.key);
      try {
        await lastValueFrom(await interceptorWith(PAIRED_TENANT).intercept(routeContext(r, req), ran));
        if (req.user.tenantId !== PAIRED_TENANT) refused.push(`${r.key} (tenant ${String(req.user.tenantId)})`);
      } catch (e) {
        refused.push(`${r.key} (${(e as Error).message})`);
      }
    }
    expect(refused).toEqual([]);
  });
});

describe('SDW-01 — end to end: a device credential for a screen with no tenant is stopped before the handler', () => {
  beforeEach(() => invalidateDeviceCredentialCache());

  it('GET /integrations/social/posts: JwtAuthGuard accepts the credential, the interceptor refuses it, the handler never runs', async () => {
    const token = registrationToken();
    const req: any = { method: 'GET', originalUrl: '/api/v1/integrations/social/posts', headers: { authorization: `Bearer ${token}` } };
    const http = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    const redis = { sismember: jest.fn(async () => false), getTokenInvalidBefore: jest.fn(async () => null) };

    // 1. The signature is good, so the guard builds a device principal (unchanged).
    await expect(new JwtAuthGuard(new JwtService({}), redis as any).canActivate(http)).resolves.toBe(true);
    expect(req.user).toMatchObject({ kind: 'device', sub: SCREEN_ID });
    expect(req.user.tenantId).toBeUndefined();

    // 2. The live row has no tenant, so the interceptor stops the request here.
    const posts = routes.find((r) => r.key === 'GET /api/v1/integrations/social/posts')!;
    const handler = jest.fn(() => of('handler-ran'));
    await expect(
      lastValueFrom(await interceptorWith(null).intercept(routeContext(posts, req), { handle: handler } as any)),
    ).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });
});
