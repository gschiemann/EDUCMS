/**
 * SEC-001 — DEVICE ROUTE INVENTORY. This file is the acceptance proof.
 *
 * THE DEFECT. `POST /api/v1/screens/register` mints a one-hour device JWT from
 * a device FINGERPRINT alone and stamps `unproven: true` (DEVAUTH-01,
 * 2026-08-04). `verifyDeviceForScreen` validated signature, subject, live row,
 * REVOKED status, tenant and credential epoch — and never read that claim. So
 * anyone who learned a screen's fingerprint (the dashboard shows one with a
 * copy button; `GET /screens` carries it; it appears in support tickets, OTA
 * logs and fleet exports) held a bearer credential for a paired, life-safety
 * display: read its manifest and emergency state, mint stream tickets, forge
 * its telemetry and render proof, drive the panel, and call
 * `POST /screens/unpair/:fingerprint` — which clears tenant and group
 * assignment, deletes every schedule, rotates the credential epoch and removes
 * the screen from its emergency channel.
 *
 * WHY A GENERATED INVENTORY AND NOT A HAND-WRITTEN LIST OF TESTS. The
 * underlying failure was not a missing check on one route, it was that a route
 * could get a weak credential by SAYING NOTHING — `allowUnpaired` defaulted
 * permissive, `unproven` was never asked about, and `/unpair` inherited both.
 * A hand-written list would go stale the first time someone adds a route. So
 * this spec SCANS THE SOURCE for every device-authenticated call site and
 * requires each one to appear in the table below with an explicit decision.
 * Add a device route and this file fails until you decide what an unproven
 * credential may do with it.
 *
 * THE TWO DEVICE-AUTH PATHS, both covered here:
 *   A. `verifyDeviceForScreen` — explicit per-route device auth. Scanned and
 *      table-driven below. An unproven credential is refused on ALL of them.
 *   B. `JwtAuthGuard` + `DeviceIdentityInterceptor` — the guard surface a
 *      `kind: 'device'` principal reaches. Capability-shaped: an unproven
 *      credential may READ (the manifest is the emergency system's documented
 *      HTTP-polling backstop — refusing it darkens a screen) and may never
 *      WRITE. Asserted at the bottom, and in
 *      `security/device-identity.interceptor.spec.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { lastValueFrom, of } from 'rxjs';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

import {
  verifyDeviceForScreen,
  invalidateDeviceCredentialCache,
  DEVICE_AUTH_REASON_UNPROVEN,
  DEVICE_TOKEN_AUD_BOOTSTRAP,
} from './device-auth';
import { DeviceIdentityInterceptor } from '../security/device-identity.interceptor';

const DEVICE_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-inventory-001';
const API_SRC = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// THE INVENTORY
// ─────────────────────────────────────────────────────────────────────────────

type UnpairedPolicy = 'allowed' | 'refused';

interface DeviceAuthSite {
  /** Path relative to `apps/api/src`, plus the enclosing method name. */
  file: string;
  fn: string;
  /** Every HTTP route this call site gates. */
  routes: string[];
  /**
   * What the call site passes for `allowUnpaired`, asserted against the source.
   * 'allowed' === the route serves a screen with no tenant yet.
   */
  unpaired: UnpairedPolicy;
  /**
   * SEC-001 verdict. `false` everywhere — no production route accepts a
   * credential minted from a fingerprint. Flipping one to `true` requires
   * changing this table, which is the point.
   */
  unprovenAllowed: false;
  /** Why refusing an unproven credential here is the right answer. */
  why: string;
}

const DEVICE_AUTH_SITES: DeviceAuthSite[] = [
  {
    file: 'screens/screens.controller.ts',
    fn: 'issueStreamTicket',
    routes: ['POST /api/v1/screens/:id/stream-ticket'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Mints a SECONDARY credential (60 s SSE ticket). A fingerprint must never be exchangeable for another credential.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'heartbeatProvesDevice',
    routes: [
      'GET /api/v1/screens/status/:deviceFingerprint (pairing-code disclosure gate + heartbeat WRITE gate)',
      'POST /api/v1/screens/status/:deviceFingerprint/crash-report',
      'POST /api/v1/screens/status/:deviceFingerprint/boot-diagnostic',
    ],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Gates read-back of Screen.pairingCode — the CLAIM credential. Fingerprint -> unproven token -> pairing code -> pair into the attacker\'s own tenant was a live screen-theft chain. Refusal only withholds the code; the pairing splash sources it from the register response. Since 2026-09-08 (school-security audit item 3 / internal F-D) the SAME verdict also gates the heartbeat WRITES: on a paired screen, lastPingAt/status, playerVersion/playerVersionCode, managerVersion and the forceApkUpdatePendingAt clear + INSTALLED stamp all require this credential, because a forged heartbeat held a dead screen at ONLINE, falsified the fleet firmware view and faked OTA completion with nothing but a fingerprint.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'reportOtaState',
    routes: ['POST /api/v1/screens/status/:deviceFingerprint/ota-state'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Writes fleet-visible OTA progress. Spoofable OTA state hides a stuck rollout.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'deviceInitiatedUnpair',
    routes: ['POST /api/v1/screens/unpair/:deviceFingerprint'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'THE headline route. Clears tenant + group, deletes every Schedule, rotates the credential epoch, removes the screen from its emergency channel. Was reachable with two anonymous requests.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'setOrientationFromDevice',
    routes: ['PUT /api/v1/screens/:id/orientation/device'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Rotates what is on the glass. A screen bolted sideways is an availability failure during an alert.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'postGameState',
    routes: ['POST /api/v1/screens/:id/game-state'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Writes tenant sports state at up to 16 Hz.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'getEmergencyRev',
    routes: ['GET /api/v1/screens/:id/emergency-rev'],
    unpaired: 'refused',
    unprovenAllowed: false,
    why: 'Cheapest authenticated endpoint in the app (5 s poll). Degrades gracefully: the manifest still carries the live emergency block, so an unproven screen keeps receiving alerts on the documented polling backstop.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'reportCacheStatus',
    routes: ['POST /api/v1/screens/:id/cache-status'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Fleet health. A spoofable health channel masks a dead life-safety screen.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'reportRenderProof',
    routes: ['POST /api/v1/screens/:id/render-proof'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'THE claim that content is on the glass. An unauthenticatable screen must never be able to report healthy.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'getEmergencyAssets',
    routes: ['GET /api/v1/screens/:id/emergency-assets'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Enumerates every emergency media URL across all panic playlists — exactly what sec-fix wave1 #4 authenticated it to prevent.',
  },
  {
    file: 'screens/screens.controller.ts',
    fn: 'getMenu',
    routes: ['GET /api/v1/screens/:id/menu'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Live per-location POS prices and 86 state — tenant commercial data.',
  },
  {
    file: 'screens/gpio.controller.ts',
    fn: 'gpioEvent',
    routes: ['POST /api/v1/screens/:id/gpio-event'],
    unpaired: 'refused',
    unprovenAllowed: false,
    why: 'Can FABRICATE A LOCKDOWN from a dry contact. The highest-consequence write in the product.',
  },
  {
    file: 'display/display.controller.ts',
    fn: 'reportCapabilities',
    routes: ['POST /api/v1/screens/:id/display-capabilities'],
    unpaired: 'refused',
    unprovenAllowed: false,
    why: 'Seeds the display-control model that decides how a panel is powered and dimmed.',
  },
  {
    file: 'telemetry/telemetry.controller.ts',
    fn: 'report',
    routes: ['POST /api/v1/screens/:id/telemetry'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Same posture as render-proof and cache-status: a spoofable telemetry channel could mask a real outage for any screen in the fleet.',
  },
  {
    file: 'player-logs/player-logs.controller.ts',
    fn: 'verifyDevice',
    routes: ['POST /api/v1/player-logs/:screenId'],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'A verified device writes an immutable AuditLog row attributed to its tenant. Refusal downgrades to the existing unattributed path — the upload still succeeds, it just cannot forge tenant-attributed forensics.',
  },
  {
    file: 'player-ota/player-ota.controller.ts',
    fn: 'isDeviceAuthenticated',
    routes: [
      'POST /api/v1/player/update-check',
      'POST /api/v1/player/manager-update-check',
    ],
    unpaired: 'allowed',
    unprovenAllowed: false,
    why: 'Returns a trust BOOLEAN, not a gate: update-check only hard-requires device auth under OTA_REQUIRE_DEVICE_AUTH, so a screen on a downgraded credential can still take the OTA that may fix it. What it loses is the authenticated version-report and the install-confirmation path.',
  },
  {
    file: 'sports/sports-board.controller.ts',
    fn: 'beaconCapability',
    routes: ['POST /api/v1/sports/board/:id/beacon-capability'],
    unpaired: 'refused',
    unprovenAllowed: false,
    why: 'SEC-007. Mints a SECONDARY credential — a 30-minute proof-of-play beacon capability whose rows are billed to sponsors as measured evidence. A fingerprint must never be exchangeable for that. Refusal is not a lockout: the caller still gets an UNVERIFIED capability, so the board keeps reporting and the report labels those counts as not-proof.',
  },
];

/**
 * Routes the SEC-001 brief named explicitly. Every one must be present in the
 * inventory above (path A) or the guard-path list below (path B), so a future
 * refactor cannot quietly drop one.
 */
const MUST_COVER = [
  'stream-ticket',
  'unpair',
  'render-proof',
  'cache-status',
  'telemetry',
  'emergency-assets',
  'emergency-rev',
  'display-capabilities',
  'update-check', // OTA
  'gpio-event',
];

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE SCAN — what the code ACTUALLY does
// ─────────────────────────────────────────────────────────────────────────────

interface ScannedSite {
  file: string;
  fn: string;
  line: number;
  /** The call's argument text, parens balanced across lines. */
  args: string;
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      listSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pure pass-throughs: they forward whatever the ROUTE gave them and gate
 * nothing themselves, so they carry no policy of their own. Kept as a named,
 * deliberately tiny set — anything else that calls the verifier IS a route and
 * owes a decision. `assertsDelegates` below proves each really is a forwarder
 * (it must not hardcode either permissive option).
 */
const DELEGATING_WRAPPERS = new Set(['screens/screens.controller.ts#deviceAuth']);

/** Class-method signature at the conventional 2-space indent. */
const METHOD_RE = /^ {2}(?:private |public |protected )?(?:async )?([A-Za-z_$][\w$]*)\s*\(/;
/** A call to the shared verifier, under any of its import aliases. */
const CALL_RE = /(?:verifyDeviceForScreen|verifyDeviceForScreenShared|this\.deviceAuth)\s*\(/;

function scanDeviceAuthSites(): ScannedSite[] {
  const sites: ScannedSite[] = [];
  for (const file of listSourceFiles(API_SRC)) {
    const rel = path.relative(API_SRC, file).split(path.sep).join('/');
    // The verifier's own module defines and documents the function; it is not
    // a route. Same for the interceptor, covered separately below.
    if (rel === 'screens/device-auth.ts') continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip comments and import statements — prose mentions the verifier a lot.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      if (trimmed.startsWith('import ') || /^\s*verifyDeviceForScreen as /.test(line)) continue;
      const match = CALL_RE.exec(line);
      if (!match) continue;

      // Enclosing method name.
      let fn = '<unknown>';
      for (let j = i; j >= 0; j--) {
        const m = METHOD_RE.exec(lines[j]);
        if (m && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while' && m[1] !== 'catch') {
          fn = m[1];
          break;
        }
      }

      // Balanced argument capture from the call's opening paren.
      let depth = 0;
      let started = false;
      let args = '';
      outer: for (let j = i; j < lines.length && j < i + 60; j++) {
        const from = j === i ? match.index + match[0].length - 1 : 0;
        for (let k = from; k < lines[j].length; k++) {
          const ch = lines[j][k];
          if (ch === '(') { depth++; started = true; if (depth === 1) continue; }
          else if (ch === ')') { depth--; if (depth === 0) break outer; }
          if (started) args += ch;
        }
        args += '\n';
      }
      sites.push({ file: rel, fn, line: i + 1, args });
    }
  }
  return sites;
}

const keyOf = (s: { file: string; fn: string }) => `${s.file}#${s.fn}`;
const allScanned = scanDeviceAuthSites();
const delegating = allScanned.filter((s) => DELEGATING_WRAPPERS.has(keyOf(s)));
/** Route-owning call sites — everything that is not a pure forwarder. */
const scanned = allScanned.filter((s) => !DELEGATING_WRAPPERS.has(keyOf(s)));

// ─────────────────────────────────────────────────────────────────────────────

function token(claims: Record<string, unknown> = {}, expiresIn = '180d'): string {
  return jwt.sign(
    { sub: SCREEN_ID, deviceId: SCREEN_ID, kind: 'device', ep: 0, ...claims },
    DEVICE_SECRET,
    { expiresIn: expiresIn as any },
  );
}
const req = (tok: string) => ({ headers: { authorization: `Bearer ${tok}` } }) as any;
const pairedRow = {
  id: SCREEN_ID,
  tenantId: 'tenant-victim',
  screenGroupId: 'group-1',
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
};
const deps = () => ({
  prisma: { client: { screen: { findUnique: jest.fn().mockResolvedValue(pairedRow) } } } as any,
  redis: { sismember: jest.fn().mockResolvedValue(false) },
});

beforeEach(() => invalidateDeviceCredentialCache());

// ─────────────────────────────────────────────────────────────────────────────
// 1. The inventory matches the code — this is what fails on a NEW device route
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-001 inventory completeness', () => {
  it('the scan found the device-auth call sites at all (guards the scanner itself)', () => {
    // A scanner that silently matches nothing would make every test below pass
    // vacuously — the exact shape of false green this program exists to avoid.
    expect(scanned.length).toBeGreaterThanOrEqual(16);
    expect(new Set(scanned.map((s) => s.file)).size).toBeGreaterThanOrEqual(6);
    expect(scanned.every((s) => s.fn !== '<unknown>')).toBe(true);
  });

  it('EVERY device-authenticated call site in the API has a SEC-001 decision', () => {
    const declared = new Set(DEVICE_AUTH_SITES.map(keyOf));
    const undeclared = scanned
      .filter((s) => !declared.has(keyOf(s)))
      .map((s) => `${s.file}:${s.line} (${s.fn})`);
    expect(undeclared).toEqual([]);
    // ^ If this fails you added a device-authenticated route. Add it to
    //   DEVICE_AUTH_SITES with an explicit unproven verdict. Do not delete
    //   this test.
  });

  it('every declared row still exists in the code (no stale inventory)', () => {
    const found = new Set(scanned.map(keyOf));
    const missing = DEVICE_AUTH_SITES.map(keyOf).filter((k) => !found.has(k));
    expect(missing).toEqual([]);
  });

  it('NO call site opts into `allowUnproven` — a fingerprint buys nothing', () => {
    const offenders = scanned
      .filter((s) => /allowUnproven/.test(s.args))
      .map((s) => `${s.file}:${s.line} (${s.fn})`);
    expect(offenders).toEqual([]);
  });

  it('each call site\'s `allowUnpaired` matches its declared policy', () => {
    const byKey = new Map(DEVICE_AUTH_SITES.map((r) => [keyOf(r), r]));
    const drift: string[] = [];
    for (const site of scanned) {
      const row = byKey.get(keyOf(site));
      if (!row) continue;
      const inSource: UnpairedPolicy = /allowUnpaired\s*:\s*true/.test(site.args)
        ? 'allowed'
        : 'refused';
      if (inSource !== row.unpaired) {
        drift.push(`${site.file}:${site.line} (${site.fn}) source=${inSource} table=${row.unpaired}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('no call site relies on the DEFAULT for `allowUnpaired` — it must be stated', () => {
    // The default now fails closed, but "the route said nothing" is how
    // /unpair inherited a permissive answer in the first place. Say it.
    const silent = scanned
      .filter((s) => !/allowUnpaired/.test(s.args))
      .map((s) => `${s.file}:${s.line} (${s.fn})`);
    expect(silent).toEqual([]);
  });

  it('the delegating wrappers really delegate — they hardcode no permissive option', () => {
    // If a forwarder started pinning `allowUnpaired`/`allowUnproven` itself it
    // would silently overrule every route behind it, and the per-route table
    // above would be describing something the code no longer does.
    expect(delegating.length).toBe(DELEGATING_WRAPPERS.size);
    for (const w of delegating) {
      expect(w.args).not.toMatch(/allowUnproven\s*:/);
      expect(w.args).not.toMatch(/allowUnpaired\s*:/);
    }
  });

  it('covers every route the SEC-001 brief named', () => {
    const haystack = DEVICE_AUTH_SITES.flatMap((r) => r.routes)
      .concat(GUARD_PATH_ROUTES.map((r) => r.route))
      .join(' | ');
    for (const needle of MUST_COVER) {
      expect(haystack).toContain(needle);
    }
  });

  it('every row explains WHY, so the next reader can re-decide with context', () => {
    for (const row of DEVICE_AUTH_SITES) {
      expect(row.why.length).toBeGreaterThan(30);
      expect(row.routes.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Behavioural proof — an unproven token is refused on every one of them
// ─────────────────────────────────────────────────────────────────────────────

describe.each(DEVICE_AUTH_SITES.map((r) => [r.routes[0], r] as const))(
  'SEC-001 refusal — %s',
  (_label, row) => {
    const opts = { allowUnpaired: row.unpaired === 'allowed' };

    it('refuses the `unproven` credential a fingerprint mints', async () => {
      const res = await verifyDeviceForScreen(deps(), req(token({ unproven: true }, '1h')), SCREEN_ID, opts);
      expect(res).toEqual({ ok: false, reason: DEVICE_AUTH_REASON_UNPROVEN });
    });

    it('refuses the bootstrap AUDIENCE even without the `unproven` claim', async () => {
      const res = await verifyDeviceForScreen(
        deps(),
        req(token({ aud: DEVICE_TOKEN_AUD_BOOTSTRAP }, '1h')),
        SCREEN_ID,
        opts,
      );
      expect(res).toEqual({ ok: false, reason: DEVICE_AUTH_REASON_UNPROVEN });
    });

    it('still accepts the PROVEN credential a real screen holds', async () => {
      const res = await verifyDeviceForScreen(deps(), req(token()), SCREEN_ID, opts);
      expect(res).toMatchObject({ ok: true, tenantId: 'tenant-victim' });
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. The guard path (JwtAuthGuard + DeviceIdentityInterceptor)
// ─────────────────────────────────────────────────────────────────────────────

interface GuardPathRoute {
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Whether an UNPROVEN credential may reach the handler. */
  unprovenReaches: boolean;
  why: string;
}

const GUARD_PATH_ROUTES: GuardPathRoute[] = [
  {
    route: 'GET /api/v1/screens/:id/manifest',
    method: 'GET',
    unprovenReaches: true,
    why: 'THE life-safety read. CLAUDE.md emergency safeguard #4: the manifest carries the live `emergency` block and is the HTTP-polling backstop. Screens reach the unproven state routinely (APK re-sideload, cleared WebView storage, a token expired over summer break, a superseded epoch); refusing this would darken them and stop alert delivery. Residual exposure is content confidentiality for a screen whose fingerprint already leaked — tracked in the SEC-001 report.',
  },
  {
    route: 'GET /api/v1/emergency/status',
    method: 'GET',
    unprovenReaches: true,
    why: 'Same life-safety read class as the manifest.',
  },
  {
    route: 'GET /api/v1/emergency/messages',
    method: 'GET',
    unprovenReaches: true,
    why: 'Poll-tier emergency messages; same class.',
  },
  {
    route: 'POST /api/v1/analytics/touch-events',
    method: 'POST',
    unprovenReaches: false,
    why: 'A WRITE. Poisons tenant analytics aggregates.',
  },
];

describe('SEC-001 guard path — read yes, write never', () => {
  const ctx = (r: any) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => r }) }) as any;
  const next = { handle: () => of('handler-ran') } as any;
  const interceptor = () =>
    new DeviceIdentityInterceptor({
      client: { screen: { findUnique: jest.fn().mockResolvedValue(pairedRow) } },
    } as any);
  const request = (method: string, claims: Record<string, unknown>) => ({
    method,
    headers: { authorization: `Bearer ${token(claims, '1h')}` },
    user: { id: SCREEN_ID, sub: SCREEN_ID, kind: 'device' },
  });

  it.each(GUARD_PATH_ROUTES.map((r) => [r.route, r] as const))('%s', async (_label, row) => {
    const r = request(row.method, { unproven: true });
    if (row.unprovenReaches) {
      await expect(lastValueFrom(await interceptor().intercept(ctx(r), next))).resolves.toBe(
        'handler-ran',
      );
      // Reaching the handler is not the same as being trusted: the principal
      // carries the verdict so a handler can narrow its own response.
      expect((r.user as Record<string, unknown>).unproven).toBe(true);
    } else {
      await expect(lastValueFrom(await interceptor().intercept(ctx(r), next))).rejects.toThrow(
        /unproven/i,
      );
    }
  });

  it('a device-reachable mutation added later is refused without touching this list', async () => {
    // The rule is method-shaped, not route-shaped, precisely so it cannot be
    // forgotten. A brand-new POST nobody has thought about yet:
    const r = request('POST', { unproven: true });
    await expect(lastValueFrom(await interceptor().intercept(ctx(r), next))).rejects.toThrow(
      /unproven/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The mint side — what a fingerprint actually gets back
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-001 mint side', () => {
  it('a bootstrap credential is refused by the verifier even at the right epoch and tenant', async () => {
    // The audit's reproduction, inverted. It signed an `unproven` token with a
    // test secret against a stubbed PAIRED screen row and the verifier answered
    // {"accepted":true,"tenantId":"tenant-victim","unprovenClaim":true}.
    const res = await verifyDeviceForScreen(
      deps(),
      req(token({ unproven: true, tenantId: 'tenant-victim' }, '1h')),
      SCREEN_ID,
      { allowUnpaired: true },
    );
    expect(res).toEqual({ ok: false, reason: DEVICE_AUTH_REASON_UNPROVEN });
    expect((res as { ok: false }).ok).toBe(false);
  });
});
