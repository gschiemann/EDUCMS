/**
 * SEC-009 — TWO-TENANT ISOLATION MATRIX: THE SIGNED / PUBLIC URLS (2026-09-05).
 *
 * `two-tenant-role-matrix.spec.ts` proves that a request from tenant A cannot
 * read or write tenant B's rows. That is not the whole boundary. This platform
 * also HANDS OUT bearer artefacts — a signed storage URL, a stream ticket, a
 * render capability, a beacon capability — and every one of them is designed to
 * be used LATER, by a caller the API will not re-authorise:
 *
 *   • a Supabase signed URL is fetched by the browser, straight from Supabase;
 *   • an SSE stream ticket travels in a URL because `EventSource` cannot set
 *     headers, and is redeemed by a different endpoint;
 *   • a render capability is redeemed on `GET /proxy/web`, which is PUBLIC;
 *   • a beacon capability is redeemed on a PUBLIC scoreboard beacon.
 *
 * So for each of them the tenant question is not "can A read B's row" but "can
 * A's principal MINT an artefact that names B's object". A leak here does not
 * look like a 200 on a foreign id — it looks like a URL in a log file that
 * still works tomorrow.
 *
 * ── WHAT THIS FILE ASSERTS, PER ARTEFACT ────────────────────────────────
 *   1. STREAM TICKET      — a device credential proven for A's screen cannot
 *                           mint a ticket naming B's screen.
 *   2. BEACON CAPABILITY  — a device credential for A's screen presented on
 *                           B's game is REFUSED, not quietly downgraded to the
 *                           anonymous lane (which would still be recorded, and
 *                           would put A's screen in B's sponsor reporting).
 *   3. RENDER CAPABILITY  — the tenant stamped on the capability comes from the
 *                           verified session, never from request input, and the
 *                           capability is bound to the one URL it was minted
 *                           for.
 *   4. STORAGE PRESIGN    — the object key an upload is presigned for is always
 *                           under the CALLER's tenant prefix, whatever the
 *                           caller puts in the body.
 *   5. SIGNED READ URL    — a signed URL for a floor plan (a building layout —
 *                           the most sensitive object we host) is only ever
 *                           minted after the row has been read inside the
 *                           caller's tenant. Aimed at a foreign plan, the
 *                           signer is never called AT ALL.
 *
 * These are observations. This file does not modify any transport, controller
 * or capability module.
 */

import * as jwt from 'jsonwebtoken';
import { AppRole } from '@cms/database';

import { ScreensController } from '../screens/screens.controller';
import { isUnprovenDeviceClaim, invalidateDeviceCredentialCache } from '../screens/device-auth';
import { verifyStreamTicket } from '../screens/stream-ticket';
import { SportsBoardController } from '../sports/sports-board.controller';
import { SportsService } from '../sports/sports.service';
import { SponsorsService } from '../sports/sponsors.service';
import { verifyBeaconCapability } from '../sports/beacon-capability';
import { ProxyController } from '../proxy/proxy.controller';
import { verifyRenderCapability } from '../proxy/render-capability';
import { AssetsController } from '../assets/assets.controller';
import { FloorPlansController } from '../floor-plans/floor-plans.controller';
import { makeTwoTenantPrisma, type Dataset } from './two-tenant-prisma';

const DEVICE_JWT_SECRET = 'sec009_signedurl_device_jwt_secret_0123456789ab';

const A = { tenantId: 't-alpha', screenId: 'scr-alpha', groupId: 'grp-alpha', fingerprint: 'fp-alpha' } as const;
const B = { tenantId: 't-beta', screenId: 'scr-beta', groupId: 'grp-beta', fingerprint: 'fp-beta' } as const;

const prev: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of [
    'DEVICE_JWT_SECRET',
    'DEVICE_SECRET_KEY',
    'SPORTS_BEACON_SECRET',
    'PROXY_RENDER_SECRET',
    'NODE_ENV',
  ]) {
    prev[k] = process.env[k];
  }
  process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  process.env.DEVICE_SECRET_KEY = 'sec009_signedurl_device_secret_0123456789ab';
  process.env.SPORTS_BEACON_SECRET = 'sec009_signedurl_beacon_secret_0123456789ab';
  process.env.PROXY_RENDER_SECRET = 'sec009_signedurl_render_secret_0123456789ab';
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => invalidateDeviceCredentialCache());

// ── Device-credential harness (shared shape with realtime-tenant-scope) ────

type Party = typeof A | typeof B;

function liveRow(p: Party, overrides: Record<string, unknown> = {}) {
  return {
    id: p.screenId,
    deviceFingerprint: p.fingerprint,
    pairingCode: null,
    tenantId: p.tenantId,
    screenGroupId: p.groupId,
    status: 'ONLINE',
    credentialEpoch: 1,
    credentialEpochRotatedAt: null,
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    name: `Screen ${p.screenId}`,
    authState: 'PROVEN',
    ...overrides,
  };
}

function screenPrisma(rows: Record<string, any>) {
  const find = async ({ where }: any = {}) => {
    if (where?.id) return rows[where.id] ?? null;
    if (where?.deviceFingerprint) {
      return Object.values(rows).find((r: any) => r.deviceFingerprint === where.deviceFingerprint) ?? null;
    }
    return null;
  };
  return {
    client: {
      screen: {
        findUnique: jest.fn(find),
        findFirst: jest.fn(find),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      game: { findUnique: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})) },
    },
  } as any;
}

/**
 * Mint a PROVEN device credential for `p` by driving the REAL register
 * handler. A hand-shaped JWT would only prove the code refuses the shape the
 * test author imagined; the server's own mint is the thing under test.
 */
async function provenTokenFor(p: Party): Promise<string> {
  const prior = jwt.sign({ sub: p.screenId, kind: 'device', ep: 0 }, DEVICE_JWT_SECRET, {
    expiresIn: '180d',
  });
  const prisma: any = screenPrisma({ [p.screenId]: liveRow(p, { credentialEpoch: 0 }) });
  prisma.client.screen.update = jest
    .fn()
    .mockResolvedValueOnce({ id: p.screenId, pairingCode: null, tenantId: p.tenantId, name: 'x' })
    .mockResolvedValue({ credentialEpoch: 1 });
  const controller = new ScreensController(
    prisma,
    { publish: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const res: any = await controller.register(
    { deviceFingerprint: p.fingerprint, priorDeviceToken: prior },
    { ip: '10.0.0.9', socket: { remoteAddress: '10.0.0.9' }, headers: {} } as any,
  );
  const claims: any = jwt.decode(res.deviceToken);
  expect(isUnprovenDeviceClaim(claims)).toBe(false);
  expect(claims.sub).toBe(p.screenId);
  return res.deviceToken;
}

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
  ip: '10.0.0.9',
  socket: { remoteAddress: '10.0.0.9' },
  get: () => 'api.test',
});

// ─────────────────────────────────────────────────────────────────────────
// 1. SSE STREAM TICKET
// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 signed artefacts — SSE stream ticket', () => {
  function ticketController() {
    const prisma = screenPrisma({ [A.screenId]: liveRow(A), [B.screenId]: liveRow(B) });
    return new ScreensController(
      prisma,
      { publish: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it("a tenant-A device cannot mint a stream ticket naming tenant B's screen", async () => {
    const controller = ticketController();
    const tokenA = await provenTokenFor(A);

    await expect(
      controller.issueStreamTicket(B.screenId, bearer(tokenA) as any),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("the ticket a tenant-A device DOES get names only its own screen", async () => {
    const controller = ticketController();
    const tokenA = await provenTokenFor(A);

    const { ticket } = await controller.issueStreamTicket(A.screenId, bearer(tokenA) as any);
    const verdict = verifyStreamTicket(ticket);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.screenId).toBe(A.screenId);
      expect(verdict.screenId).not.toBe(B.screenId);
    }
  });

  it('a ticket is not transferable to another screen — its id is inside the signature', async () => {
    const controller = ticketController();
    const tokenA = await provenTokenFor(A);
    const { ticket } = await controller.issueStreamTicket(A.screenId, bearer(tokenA) as any);

    // The ticket carries the screen id in the clear (`st1.<screenId>.<epoch>.…`)
    // with a MAC over it, so the interesting forgery is a literal swap: point
    // A's ticket at B's screen and re-present it.
    const forged = ticket.replace(A.screenId, B.screenId);
    expect(forged).not.toBe(ticket); // the swap must actually have happened
    expect(verifyStreamTicket(forged).ok).toBe(false);
    // …and the MAC is not merely a prefix check.
    expect(verifyStreamTicket(`${ticket}x`).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. PROOF-OF-PLAY BEACON CAPABILITY (SEC-007)
// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 signed artefacts — sports beacon capability', () => {
  const GAME_B = 'game-beta';

  function boardController(gameTenantId: string) {
    const prisma: any = screenPrisma({ [A.screenId]: liveRow(A), [B.screenId]: liveRow(B) });
    prisma.client.game.findUnique = jest.fn(async () => ({ id: GAME_B, tenantId: gameTenantId }));
    const redis: any = { publisher: null, status: 'end' };
    const sponsors = new SponsorsService(prisma);
    const sports = new SportsService(prisma, redis, {} as any, sponsors, {
      isEnabled: () => false,
    } as any);
    return new SportsBoardController(sports, redis, prisma);
  }

  it("a tenant-A screen credential is REFUSED on tenant B's game — not downgraded", async () => {
    const controller = boardController(B.tenantId);
    const tokenA = await provenTokenFor(A);

    // The refusal is the whole point. A downgrade to the anonymous lane would
    // still RECORD the beacon, putting tenant A's screen into tenant B's
    // sponsor + contractual reporting.
    await expect(
      controller.beaconCapability(GAME_B, bearer(tokenA) as any),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("a tenant-B screen credential on tenant B's own game mints a VERIFIED capability naming that screen", async () => {
    const controller = boardController(B.tenantId);
    const tokenB = await provenTokenFor(B);

    const out: any = await controller.beaconCapability(GAME_B, bearer(tokenB) as any);
    expect(out.verified).toBe(true);

    const verdict = verifyBeaconCapability(out.impression, { gameId: GAME_B, scope: 'impression' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.claims.s).toBe(B.screenId);
      expect(verdict.claims.g).toBe(GAME_B);
    }
  });

  it('a capability minted for one game does not verify for another', async () => {
    const controller = boardController(B.tenantId);
    const tokenB = await provenTokenFor(B);
    const out: any = await controller.beaconCapability(GAME_B, bearer(tokenB) as any);

    expect(
      verifyBeaconCapability(out.impression, { gameId: 'game-alpha', scope: 'impression' }),
    ).toMatchObject({ ok: false, reason: 'game_mismatch' });
    // …and not across endpoints either.
    expect(
      verifyBeaconCapability(out.impression, { gameId: GAME_B, scope: 'cue' }),
    ).toMatchObject({ ok: false, reason: 'scope_mismatch' });
  });

  it('an anonymous mint is UNVERIFIED and names no screen at all', async () => {
    const controller = boardController(B.tenantId);
    const out: any = await controller.beaconCapability(GAME_B, {
      headers: {},
      ip: '10.0.0.9',
    } as any);

    expect(out.verified).toBe(false);
    const verdict = verifyBeaconCapability(out.impression, { gameId: GAME_B, scope: 'impression' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.claims.s).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. CHROMIUM RENDER CAPABILITY (SEC-006)
// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 signed artefacts — proxy render capability', () => {
  // PUBLIC IP LITERALS, deliberately. `assertPublicUrl` skips DNS entirely for
  // a literal (it is already judged by `validatePublicUrl`), so these cases
  // behave identically on a CI runner with no outbound resolver. A hostname
  // here would make this whole describe silently vacuous the day DNS is absent.
  const URL_A = 'https://93.184.216.34/board-a';
  const URL_B = 'https://93.184.216.34/board-b';

  async function mint(url: string, req: any) {
    const controller = new ProxyController(undefined as any);
    (controller as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    return controller.mintRenderCapability({ url }, req);
  }

  const sessionA = {
    user: { id: 'user-a', tenantId: A.tenantId, role: AppRole.SCHOOL_ADMIN, kind: 'user' },
    headers: {},
  } as any;

  it("the capability's tenant comes from the SESSION, never from the request body", async () => {
    const minted: any = await mint(URL_A, {
      ...sessionA,
      // The attacker's half of the request: claim to be the other tenant.
      body: { url: URL_A, tenantId: B.tenantId },
    });
    const verdict = verifyRenderCapability(minted.capability, URL_A);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.claims.t).toBe(A.tenantId);
      expect(verdict.claims.t).not.toBe(B.tenantId);
    }
  });

  it('a capability is bound to the ONE url it was minted for', async () => {
    const minted: any = await mint(URL_A, sessionA);
    expect(verifyRenderCapability(minted.capability, URL_A).ok).toBe(true);
    expect(verifyRenderCapability(minted.capability, URL_B).ok).toBe(false);
  });

  it('an unattributable principal cannot mint one at all', async () => {
    await expect(
      mint(URL_A, { user: { tenantId: A.tenantId }, headers: {} } as any),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. STORAGE PRESIGN — the object key is the boundary
// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 signed artefacts — Supabase upload presign', () => {
  function assetsController(capture: { path?: string }) {
    const prisma = makeTwoTenantPrisma({
      tenant: [
        { id: A.tenantId, name: 'Alpha', slug: 'alpha', parentId: null, archivedAt: null },
        { id: B.tenantId, name: 'Beta', slug: 'beta', parentId: null, archivedAt: null },
      ],
      assetFolder: [{ id: 'folder-b', tenantId: B.tenantId, parentId: null, name: 'beta' }],
    } as Dataset);
    const storage: any = {
      createSignedUploadUrl: jest.fn(async (p: string) => {
        capture.path = p;
        return {
          signedUrl: `https://storage.test/upload/${p}`,
          token: 'tok',
          path: p,
          publicUrl: `https://cdn.test/${p}`,
        };
      }),
    };
    return {
      controller: new AssetsController(
        { client: prisma.client } as any,
        storage,
        {} as any,
        {} as any,
        {} as any,
        { kickOff: () => {} } as any,
      ),
      storage,
      prisma,
    };
  }

  const reqA = {
    user: { id: 'user-a', tenantId: A.tenantId, role: AppRole.SCHOOL_ADMIN },
    headers: {},
  } as any;

  it("the presigned key is always under the CALLER's tenant prefix", async () => {
    const capture: { path?: string } = {};
    const { controller } = assetsController(capture);

    await controller.presignUpload(reqA, {
      filename: 'poster.png',
      contentType: 'image/png',
      size: 1024,
    });

    expect(capture.path).toBeDefined();
    expect(capture.path!.startsWith(`${A.tenantId}/`)).toBe(true);
    expect(capture.path).not.toContain(B.tenantId);
  });

  it('a traversal-shaped filename cannot move the key out of that prefix', async () => {
    const capture: { path?: string } = {};
    const { controller } = assetsController(capture);

    let threw = false;
    try {
      await controller.presignUpload(reqA, {
        filename: `../../${B.tenantId}/pwned.png`,
        contentType: 'image/png',
        size: 1024,
      });
    } catch {
      threw = true;
    }

    if (threw) {
      // A rejected filename is an equally good outcome — nothing was signed.
      expect(capture.path).toBeUndefined();
    } else {
      expect(capture.path!.startsWith(`${A.tenantId}/`)).toBe(true);
      expect(capture.path).not.toContain('..');
    }
    // Either way — and this is the assertion that must never be skipped —
    // nothing was signed anywhere near the other tenant's prefix.
    expect(capture.path ?? '').not.toContain(B.tenantId);
  });

  it("presigning into another tenant's folder is refused before anything is signed", async () => {
    const capture: { path?: string } = {};
    const { controller, storage } = assetsController(capture);

    await expect(
      controller.presignUpload(reqA, {
        filename: 'poster.png',
        contentType: 'image/png',
        size: 1024,
        folderId: 'folder-b',
      }),
    ).rejects.toBeDefined();
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. SIGNED READ URL — floor plans (building layouts)
// ─────────────────────────────────────────────────────────────────────────
describe('SEC-009 signed artefacts — floor-plan signed read URL', () => {
  function floorPlansController() {
    const prisma = makeTwoTenantPrisma({
      tenant: [
        { id: A.tenantId, name: 'Alpha', slug: 'alpha', parentId: null, archivedAt: null },
        { id: B.tenantId, name: 'Beta', slug: 'beta', parentId: null, archivedAt: null },
      ],
      floorPlan: [
        {
          id: 'fp-a',
          tenantId: A.tenantId,
          name: 'Alpha HS',
          imageUrl: 'https://cdn.test/plan-a.png',
          widthPx: 1000,
          heightPx: 1000,
          buildingLabel: null,
          floorLabel: null,
        },
        {
          id: 'fp-b',
          tenantId: B.tenantId,
          name: 'Beta HS',
          imageUrl: 'https://cdn.test/plan-b.png',
          widthPx: 1000,
          heightPx: 1000,
          buildingLabel: null,
          floorLabel: null,
        },
      ],
    } as Dataset);
    const storage: any = {
      parseObjectUrl: jest.fn((u: string) => ({ bucket: 'floor-plans', path: u.split('/').pop() })),
      createSignedUrl: jest.fn(async (p: string) => `https://storage.test/signed/${p}?token=t`),
    };
    return {
      controller: new FloorPlansController({ client: prisma.client } as any, storage),
      storage,
      prisma,
    };
  }

  const reqA = {
    user: { id: 'user-a', tenantId: A.tenantId, role: AppRole.SCHOOL_ADMIN },
    headers: {},
  } as any;

  it("no signed URL is minted for another tenant's building layout — the signer is never called", async () => {
    const { controller, storage } = floorPlansController();

    await expect(controller.getOne(reqA, 'fp-b')).rejects.toBeDefined();

    // The strongest form of the assertion: not "the URL was withheld" but
    // "one was never created". A signed URL that exists has already escaped —
    // it works from any browser, for its whole TTL, with no session.
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("the caller's OWN plan does get a signed URL, so the refusal above is about tenancy", async () => {
    const { controller, storage } = floorPlansController();

    const plan: any = await controller.getOne(reqA, 'fp-a');
    expect(storage.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(String(plan.imageUrl)).toContain('storage.test/signed/');
    expect(String(plan.imageUrl)).not.toContain('plan-b');
  });

  it('the list route signs only the plans inside the caller\'s tenant', async () => {
    const { controller, storage } = floorPlansController();

    const plans: any[] = (await controller.list(reqA)) as any[];
    expect(plans.map((p) => p.id)).toEqual(['fp-a']);
    for (const call of storage.createSignedUrl.mock.calls) {
      expect(String(call[0])).not.toContain('plan-b');
    }
  });
});
