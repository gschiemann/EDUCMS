import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressReq } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/with-db-retry';
import { RedisService } from '../realtime/redis.service';
import { verifyDeviceForScreen } from '../screens/device-auth';
import {
  shouldSkipLastPingWrite,
  markLastPingWritten,
  shouldSkipCacheReportWrite,
  markCacheReportWritten,
  shouldSkipRenderProofWrite,
  markRenderProofWritten,
} from '../screens/manifest-hot-cache';
import { screenTelemetrySchema, TELEMETRY_MAX_BODY_BYTES } from './telemetry.schema';
import { TELEMETRY_INTERVAL_MS, type ScreenTelemetryResponse } from './telemetry.types';

/**
 * POST /api/v1/screens/:id/telemetry — the ONE routine report a player
 * sends (2026-09-02, efficiency program P0-1).
 *
 * ── THE LOAD-BEARING PROPERTY ───────────────────────────────────────────
 * Every column this handler writes is in `SCREEN_TELEMETRY_ONLY_FIELDS`
 * (manifest-hot-cache.ts) EXCEPT `pendingRefreshAt`, and that one exception
 * is deliberate and pre-existing: clearing a refresh command IS manifest
 * content, so that write MUST bust the per-screen manifest cache — exactly
 * as `/render-proof` does today. Everything else must not, or the fleet's
 * own telemetry re-creates the 25 GB/mo Supabase egress the hot cache was
 * built to kill (docs/research/2026-07-30-supabase-bill-diet/).
 *
 * `telemetry.spec.ts` asserts this by feeding the update's key set through
 * `shouldBumpManifestRev` — a new column added here without a matching
 * entry on that list turns the spec red.
 *
 * ── ONE ROW READ, ONE ROW WRITE ─────────────────────────────────────────
 * The endpoints this replaces did, between them, up to five DB round-trips
 * per minute per screen. This does at most two: one narrow `select` (never
 * the 88-column row — the audit measured that wire cost) and one `update`
 * that returns only `id`. The write is SKIPPED ENTIRELY when every debounce
 * says nothing changed.
 *
 * ── HOSTILE-INPUT POSTURE (lead security addendum, 2026-09-02) ──────────
 * In order, cheapest gate first, and NOTHING touches the database until
 * every one of them has passed:
 *
 *   1. `Content-Length` > 32 KB → 413. The route ALSO has its own 32 KB
 *      body parser mounted in `main.ts` ahead of the global 5 MB one, so
 *      an oversized body is refused BEFORE it is parsed; this header check
 *      is the in-handler backstop for a chunked request with no length.
 *   2. Strict zod parse (`telemetry.schema.ts`) — unknown keys REJECTED,
 *      every string length-bounded, every number range-bounded.
 *   3. Device auth. The token's `sub` must equal the path id
 *      (`verifyDeviceForScreen` enforces it), and from here on the handler
 *      uses `auth.sub` / `auth.screen`, NEVER the raw path param — a
 *      client-supplied id can never out-vote the credential.
 *   4. Per-screen accept limit: at most ONE accepted POST per 30 s. Excess
 *      is 429'd with ZERO database work, so a compromised or looping device
 *      cannot amplify writes past the designed cadence. (The IP-keyed
 *      `@Throttle` below is a separate, coarser net — a venue shares one
 *      NAT address, so it can only ever bound a whole site.)
 *   5. Explicit column map. `data` is assembled from literal keys only —
 *      the payload is never spread — and `assertColumnsAllowed` re-checks
 *      the assembled key set against `TELEMETRY_COLUMNS` before the write.
 *
 * ── COMPATIBILITY ───────────────────────────────────────────────────────
 * `GET /screens/status/:fp`, `POST /:id/cache-status` and
 * `POST /:id/render-proof` are untouched and still work. Older APKs and
 * older web bundles keep using them; only a bundle that gets a 2xx from
 * THIS route stands its own copies of those timers down. The fleet floor
 * is therefore never a release blocker for this change.
 */
@Controller('api/v1/screens')
export class TelemetryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * IP-keyed net. Sized exactly like `/render-proof`'s cap and for the same
   * reason: the throttler keys on the client IP and a venue's whole fleet
   * shares one NAT address, so this can only bound a SITE. The per-screen
   * limit inside the handler is the one that bounds a DEVICE.
   */
  @Post(':id/telemetry')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async report(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() rawBody: unknown,
  ): Promise<ScreenTelemetryResponse> {
    // ── GATE 1: size, before anything else ──────────────────────────────
    const declared = Number(req?.headers?.['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > TELEMETRY_MAX_BODY_BYTES) {
      throw new HttpException(
        { code: 'TELEMETRY_BODY_TOO_LARGE', message: 'Telemetry body exceeds 32 KB' },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // ── GATE 2: strict schema ───────────────────────────────────────────
    const parsed = screenTelemetrySchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      // Deliberately terse: a device gets "your payload is wrong", not a
      // field-by-field map of what this server accepts.
      throw new HttpException(
        { code: 'TELEMETRY_BODY_INVALID', message: 'Telemetry body failed validation' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const body = parsed.data;

    // ── GATE 3: device auth ─────────────────────────────────────────────
    // Identical posture to /cache-status and /render-proof: a spoofable
    // telemetry channel could mask a real outage for any screen in the
    // fleet, which is the whole reason those two are authenticated.
    // `allowUnpaired` defaults to true on purpose — an unpaired screen
    // still needs its liveness recorded (that is the pairing splash's
    // ONLINE dot), and nothing this handler writes is tenant-scoped.
    const auth = await verifyDeviceForScreen(
      { prisma: this.prisma, redis: this.redisService },
      req,
      id,
      // SEC-001 (2026-09-04) — `allowUnpaired: true` is this route's PRIOR
      // behaviour, now stated: the shared verifier's default flipped to
      // fail-closed so a NEW device route cannot inherit a weak credential by
      // saying nothing. An UNPROVEN credential (minted from a fingerprint
      // alone) is refused, which is the same reasoning the comment above gives
      // for authenticating this route at all — a spoofable telemetry channel
      // masks a real outage, and a fingerprint is not a secret.
      { allowUnpaired: true },
    );
    if (!auth.ok) {
      throw new HttpException(
        {
          code: 'SCREEN_DEVICE_AUTH_REQUIRED',
          message: `Device auth required (${auth.reason})`,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // From here on: the CREDENTIAL's screen id, never the path param. They
    // are already equal (the verifier compares `sub` to the path id and
    // fails otherwise) — using this one makes that non-bypassable by a
    // later edit rather than merely true today.
    const screenId = auth.sub;

    // ── GATE 4: per-screen accept limit, BEFORE any database work ───────
    if (!acceptTelemetryPost(screenId)) {
      throw new HttpException(
        {
          code: 'TELEMETRY_TOO_FREQUENT',
          message: 'At most one telemetry report per 30s per screen',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── ONE narrow read ─────────────────────────────────────────────────
    const screen = await withDbRetry(
      () =>
        // ten-ok: self-scoped device read — the device token this request
        // carries was verified against THIS screen id by the auth guard, and
        // the row's own tenantId is what scopes every write below.
        this.prisma.client.screen.findUnique({
          where: { id: screenId },
          select: {
            id: true,
            tenantId: true,
            name: true,
            playerVersion: true,
            playerVersionCode: true,
            managerVersion: true,
            forceApkUpdatePendingAt: true,
            pendingRefreshAt: true,
            lastOtaState: true,
            lastOtaProgress: true,
            lastOtaMessage: true,
            lastOtaAt: true,
            displayCapabilitiesAt: true,
          },
        }),
      { label: 'screen.findUnique[telemetry]' },
    );
    if (!screen) {
      throw new HttpException(
        { code: 'SCREEN_NOT_FOUND', message: 'Not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const now = new Date();
    const data: Record<string, unknown> = {};

    // ── 1. LIVENESS (was: GET /screens/status/:fp) ──────────────────────
    // Same 25 s debounce the manifest and heartbeat paths already use. At
    // the 60 s telemetry cadence it never actually skips; it is here so a
    // client that bursts cannot amplify writes.
    if (!shouldSkipLastPingWrite(screenId)) {
      markLastPingWritten(screenId);
      data.lastPingAt = now;
      data.status = screen.tenantId ? 'ONLINE' : 'PENDING';
    }

    // ── 2. VERSIONS (was: ?v= / ?vc= / ?mv= on the status heartbeat) ────
    const vn = (body.versions?.player ?? '').trim();
    let otaCleared = false;
    if (vn) {
      data.playerVersion = vn;
      data.playerVersionAt = now;
      const vc = body.versions?.playerCode;
      if (typeof vc === 'number' && vc > 0) {
        data.playerVersionCode = Math.floor(vc);
        const priorVc = Number(screen.playerVersionCode || 0);
        // An operator's pending APK push is cleared by the INSTALL landing,
        // proven by a version-code increase — identical rule to the legacy
        // heartbeat, kept byte-for-byte so a mixed fleet behaves the same.
        if (screen.forceApkUpdatePendingAt && Math.floor(vc) > priorVc) {
          data.forceApkUpdatePendingAt = null;
          data.lastOtaState = 'INSTALLED';
          data.lastOtaProgress = 100;
          data.lastOtaMessage = `Installed v${vn}`;
          data.lastOtaAt = now;
          otaCleared = true;
        }
      }
    }
    // Manager: key ABSENT = this build has no opinion (leave the column
    // alone); `''`/`null` = the EXPLICIT "Manager is not installed" signal
    // that clears the dashboard chip. Both states must survive; `in` is
    // what distinguishes them (a truthiness test would conflate them, the
    // 2026-04-28 bug).
    if (body.versions && 'manager' in body.versions) {
      const mv = (body.versions.manager ?? '').trim();
      if (mv) {
        if (mv !== screen.managerVersion) {
          data.managerVersion = mv;
          data.managerVersionAt = now;
        }
      } else if (screen.managerVersion !== null) {
        data.managerVersion = null;
        data.managerVersionAt = null;
      }
    }

    // ── 3. CACHE STATE (was: POST /:id/cache-status) ────────────────────
    // Same content-signature debounce: an identical report inside 120 s
    // writes nothing (this UPDATE was ~42 % of all DB time before the
    // debounce landed), a changed one writes through immediately.
    if (body.cache) {
      const report = {
        playlist: sanitizeTier(body.cache.playlist),
        emergency: sanitizeTier(body.cache.emergency),
      };
      const sig = JSON.stringify(report);
      if (!shouldSkipCacheReportWrite(screenId, sig)) {
        markCacheReportWritten(screenId, sig);
        data.lastCacheReport = report;
        data.lastCacheReportAt = now;
      }
    }

    // ── 4. RENDER PROOF (was: POST /:id/render-proof) ───────────────────
    // The client OMITS `render` entirely when its paint counter has not
    // advanced, so a wedged compositor stops refreshing `lastRenderedAt`
    // and the fleet flags it STALE. Never synthesize a proof here.
    const bundleSha = normalizeBundleSha(body.versions?.bundleSha);
    // 2026-09-21 — the identity the player actually reloads on. Same
    // normalization rule as the SHA (see normalizeBundleSha): bounded token,
    // lowercased, 12 chars. A value that fails the rule is dropped to null —
    // "unknown", which the dashboard renders by falling back to the SHA
    // comparison — and NEVER a 400. A garbage build identifier must not be
    // able to make a screen stop reporting.
    const bundleId = normalizeBundleSha(body.versions?.bundleId);
    if (body.render) {
      if (!shouldSkipRenderProofWrite(screenId, bundleSha ?? '', bundleId ?? '')) {
        markRenderProofWritten(screenId, bundleSha ?? '', bundleId ?? '');
        data.lastRenderedAt = now;
        const frames = body.render.frames;
        if (typeof frames === 'number') {
          data.lastRenderedFrames = Math.min(Math.floor(frames), Number.MAX_SAFE_INTEGER);
        }
        if (body.render.hash) data.lastRenderedHash = String(body.render.hash).slice(0, 128);
        if (bundleSha) {
          data.lastBundleSha = bundleSha;
          data.lastBundleShaAt = now;
        }
        // Written beside the SHA, dated by lastBundleShaAt (same statement,
        // same instant) — a second timestamp would only be a second thing
        // that can disagree with the first.
        if (bundleId) data.lastBundleId = bundleId;
        const syncReport = sanitizeSyncReport(body.render.sync);
        if (syncReport) {
          data.lastSyncReport = syncReport;
          data.lastSyncReportAt = now;
        }
      }
    }

    // ── 4b. VIDEO PLAYBACK QUALITY (2026-09-24) ─────────────────────────
    // The dropped-frame sample for the clip the player last played, with its
    // rebuffer pauses when the player counts them. Its own block, outside
    // the render-proof debounce: the client sends it only when it has a NEW
    // sample, so every arrival is worth one write. Never synthesized — a
    // screen that played no video keeps its last sample.
    const videoReport = sanitizeVideoReport(body.video);
    if (videoReport) {
      data.lastVideoReport = { ...videoReport, at: now.toISOString() };
      data.lastVideoReportAt = now;
    }

    // ── 5. DURABLE-REFRESH ACK (was: render-proof's refreshAckMs) ───────
    // VALUE IDENTITY, never a clock comparison (player rule 6).
    const refreshAckMs =
      typeof body.refreshAckMs === 'number' ? Math.floor(body.refreshAckMs) : null;
    const refreshAcked =
      refreshAckMs !== null &&
      screen.pendingRefreshAt !== null &&
      new Date(screen.pendingRefreshAt).getTime() === refreshAckMs;
    if (refreshAcked) {
      // ⚠️ THE ONE KEY HERE THAT IS NOT TELEMETRY-ONLY, ON PURPOSE. Clearing
      // the flag changes what the manifest says, so this write MUST bust the
      // per-screen manifest cache — identical to /render-proof today.
      data.pendingRefreshAt = null;
    }

    // ── ONE write (or none) ─────────────────────────────────────────────
    if (Object.keys(data).length > 0) {
      assertColumnsAllowed(data);
      await withDbRetry(
        () =>
          // ten-ok: self-scoped device write — same screen id the device
          // token proved above; columns are allowlisted by assertColumnsAllowed.
          this.prisma.client.screen.update({
            where: { id: screenId },
            data: data as any,
            // Fire-and-forget telemetry — never RETURNING the whole row.
            select: { id: true },
          }),
        { label: 'screen.update[telemetry]' },
      );
    }

    // The ack is the only moment we can prove a refresh command completed —
    // the clear IS the ack, there is no persisted ack column — so record it
    // on the timeline before the evidence is gone. Best-effort: the command
    // already completed, and a failed row must not turn a successful ack
    // into a 500 that makes the player retry forever.
    if (refreshAcked && screen.tenantId) {
      try {
        await this.prisma.client.screenEvent.create({
          data: {
            screenId,
            // Tenant scoping comes from the LIVE ROW, never from a claim —
            // the same DT-03 discipline device-auth.ts applies.
            tenantId: screen.tenantId,
            kind: 'refresh-acked',
            detail: { valueMs: refreshAckMs },
          },
        });
      } catch {
        /* timeline best-effort */
      }
    }

    // ── RESPONSE: everything the retired GETs handed the player ─────────
    const forceAt = otaCleared ? null : screen.forceApkUpdatePendingAt;
    const FORCE_FRESH_MS = 24 * 60 * 60 * 1000;
    const forceUpdatePending =
      !!forceAt && Date.now() - new Date(forceAt).getTime() < FORCE_FRESH_MS;

    return {
      ok: true,
      screenId: screen.id,
      paired: !!screen.tenantId,
      name: screen.name ?? null,
      // Deliberately NOT returning `pairingCode`. The legacy status route
      // returns it to a device that proved possession because the PAIRING
      // SPLASH renders it — and the splash polls that route, never this one
      // (telemetry needs a screenId the splash does not yet trust). A secret
      // no caller reads should not be on this wire.
      ota: otaCleared
        ? { state: 'INSTALLED', progress: 100, message: `Installed v${vn}`, at: now }
        : screen.lastOtaState
          ? {
              state: screen.lastOtaState,
              progress: screen.lastOtaProgress ?? null,
              message: screen.lastOtaMessage ?? null,
              at: screen.lastOtaAt ?? null,
            }
          : null,
      versions: {
        player: (data.playerVersion as string) ?? screen.playerVersion ?? null,
        manager:
          'managerVersion' in data
            ? ((data.managerVersion as string | null) ?? null)
            : (screen.managerVersion ?? null),
      },
      forceUpdatePending,
      forceUpdatePendingAt: forceAt ? new Date(forceAt).toISOString() : null,
      refreshAcked,
      // Ask for a full capability report when the server has never had one,
      // or when the device says its probe hash moved. The verdict itself
      // still goes to /display-capabilities, which owns the per-screen
      // manifest invalidation a changed verdict requires.
      capabilitiesReportRequested:
        !screen.displayCapabilitiesAt || capsHashChanged(screenId, body.capsHash),
      nextTelemetryInMs: TELEMETRY_INTERVAL_MS,
    };
  }
}

// ── the explicit column map ───────────────────────────────────────────────

/**
 * EVERY `Screen` column this endpoint is allowed to write. The payload is
 * never spread into `data`; each key above is a literal. This set is the
 * belt for that: `assertColumnsAllowed` re-checks the assembled key set
 * before the update, so a future edit that pipes a payload field into a new
 * column fails loudly here instead of quietly writing something the fleet
 * dashboard then reports as fact.
 *
 * All of these are in `SCREEN_TELEMETRY_ONLY_FIELDS` EXCEPT
 * `pendingRefreshAt` — see the class comment for why that one must bust the
 * manifest cache. `telemetry.spec.ts` asserts both halves.
 */
export const TELEMETRY_COLUMNS: ReadonlySet<string> = new Set([
  'lastPingAt',
  'status',
  'playerVersion',
  'playerVersionAt',
  'playerVersionCode',
  'forceApkUpdatePendingAt',
  'lastOtaState',
  'lastOtaProgress',
  'lastOtaMessage',
  'lastOtaAt',
  'managerVersion',
  'managerVersionAt',
  'lastCacheReport',
  'lastCacheReportAt',
  'lastRenderedAt',
  'lastRenderedFrames',
  'lastRenderedHash',
  'lastBundleSha',
  'lastBundleShaAt',
  'lastBundleId',
  'lastSyncReport',
  'lastSyncReportAt',
  'lastVideoReport',
  'lastVideoReportAt',
  'pendingRefreshAt',
]);

function assertColumnsAllowed(data: Record<string, unknown>): void {
  const offenders = Object.keys(data).filter((k) => !TELEMETRY_COLUMNS.has(k));
  if (offenders.length > 0) {
    throw new HttpException(
      { code: 'TELEMETRY_COLUMN_NOT_ALLOWED', message: 'Telemetry write rejected' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

// ── per-screen accept limit ───────────────────────────────────────────────

/**
 * Minimum spacing between ACCEPTED telemetry posts for one screen. The
 * designed cadence is 60 s; 30 s leaves room for a retry after a transient
 * failure and for the immediate post a page makes on boot, while still
 * halving the worst case a looping device could produce.
 *
 * In-process, same discipline as every debounce in manifest-hot-cache
 * (numReplicas=1 today). On a second replica the effective floor becomes
 * 30 s per replica — still bounded, and the DB-write debounces underneath
 * are the real protection for the row.
 */
export const TELEMETRY_MIN_ACCEPT_INTERVAL_MS = 30_000;
const lastAccepted = new Map<string, number>();

function acceptTelemetryPost(screenId: string): boolean {
  const prev = lastAccepted.get(screenId);
  const now = Date.now();
  if (prev !== undefined && now - prev < TELEMETRY_MIN_ACCEPT_INTERVAL_MS) return false;
  lastAccepted.set(screenId, now);
  if (lastAccepted.size > 50_000) {
    const oldest = lastAccepted.keys().next().value;
    if (oldest) lastAccepted.delete(oldest);
  }
  return true;
}

// ── sanitizers ────────────────────────────────────────────────────────────

/** Clamp a cache tier to two non-negative ints; never store raw client JSON. */
function sanitizeTier(
  tier: { count?: number; bytes?: number } | undefined,
): { count: number; bytes: number } | undefined {
  if (!tier || typeof tier !== 'object') return undefined;
  const int = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER)
      : 0;
  return { count: int(tier.count), bytes: int(tier.bytes) };
}

/**
 * Page-bundle SHA normalization — byte-identical to the rule
 * `/render-proof` applies and to the two web-side copies
 * (`player/bundleSha.ts`, `components/screens/bundleSkew.ts`). Bounded
 * rather than hex-only on purpose: the same rule gates the player's
 * auto-reload, so narrowing it would switch that off for self-hosted
 * builds that stamp a tag or build number.
 */
function normalizeBundleSha(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s && /^[A-Za-z0-9._-]{1,64}$/.test(s) ? s.toLowerCase().slice(0, 12) : null;
}

/** Rebuild the sync block field by field — never persist the raw payload. */
function sanitizeSyncReport(sync: unknown): Record<string, unknown> | null {
  if (!sync || typeof sync !== 'object') return null;
  const s = sync as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
  return {
    locked: s.locked === true,
    errMs: num(s.errMs, 0, 60_000),
    clockUncertaintyMs: num(s.clockUncertaintyMs, 0, 600_000),
    rttMs: num(s.rttMs, 0, 60_000),
    contentSig: s.contentSig ? String(s.contentSig).slice(0, 32) : null,
    renderLeadMs: num(s.renderLeadMs, 0, 1_000),
    skewPpm: num(s.skewPpm, -500, 500),
  };
}

/**
 * Rebuild the video-quality sample field by field — never persist the raw
 * payload. Dropped frames can never exceed total frames (a decoder that
 * reports otherwise is lying, and the dashboard divides the two).
 */
export function sanitizeVideoReport(
  video: unknown,
): Record<string, unknown> | null {
  if (!video || typeof video !== 'object') return null;
  const v = video as Record<string, unknown>;
  const int = (x: unknown, hi: number): number | null =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0
      ? Math.min(Math.floor(x), hi)
      : null;
  const url = typeof v.url === 'string' ? v.url.trim().slice(0, 512) : '';
  const totalFrames = int(v.totalFrames, Number.MAX_SAFE_INTEGER);
  if (!url || totalFrames === null) return null;
  const droppedFrames = Math.min(
    int(v.droppedFrames, Number.MAX_SAFE_INTEGER) ?? 0,
    totalFrames,
  );
  const out: Record<string, unknown> = { url, totalFrames, droppedFrames };
  const elapsedMs = int(v.elapsedMs, 86_400_000);
  if (elapsedMs !== null) out.elapsedMs = elapsedMs;
  const width = int(v.width, 16_384);
  const height = int(v.height, 16_384);
  if (width !== null && height !== null) {
    out.width = width;
    out.height = height;
  }
  // Rebuffer pauses — each kept only when sent. A player that predates the
  // counter sends neither, and the dashboard must read that as "not
  // counted", never as a clean "no pauses".
  const stalls = int(v.stalls, 1_000_000);
  if (stalls !== null) out.stalls = stalls;
  const stalledMs = int(v.stalledMs, 86_400_000);
  if (stalledMs !== null) out.stalledMs = stalledMs;
  return out;
}

/**
 * Last capability-probe hash seen per screen. In-process and eviction-
 * bounded (same discipline as every debounce in manifest-hot-cache), and
 * deliberately NOT a column: the value is a hint that drives one response
 * boolean, not a fact the dashboard reads. On a replica that has never seen
 * this screen the answer is "no change" — the `displayCapabilitiesAt` null
 * check is what guarantees a first report still gets asked for.
 */
const capsHashes = new Map<string, string>();
function capsHashChanged(screenId: string, hash: string | undefined): boolean {
  if (typeof hash !== 'string' || !hash) return false;
  const bounded = hash.slice(0, 64);
  const prior = capsHashes.get(screenId);
  capsHashes.set(screenId, bounded);
  if (capsHashes.size > 50_000) {
    const oldest = capsHashes.keys().next().value;
    if (oldest) capsHashes.delete(oldest);
  }
  return prior !== undefined && prior !== bounded;
}

/** Test hook — full reset of module state between spec cases. */
export function resetTelemetryStateForTests(): void {
  capsHashes.clear();
  lastAccepted.clear();
}
