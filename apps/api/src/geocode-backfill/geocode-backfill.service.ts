import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';

/** Task #60 — back-fill lat/lng for legacy Tenant rows that already have a
 *  physical `address` (Tenant.address, added 2026-05-25 for the fleet map)
 *  but predate that feature and so never got `latitude`/`longitude` written.
 *
 *  This is intentionally a service you call, not a cron. It is NOT wired to
 *  run automatically anywhere — see GeocodeBackfillController and
 *  docs/research/2026-07-03-overnight-fixes/08-geocode-backfill.md.
 *
 *  Reuses the existing GeocodingService (Google → Census → Nominatim
 *  provider chain, GOOGLE_MAPS_API_KEY server-side only) instead of
 *  re-implementing any geocoding call — same rule as the address pickers
 *  and the fleet-map reverse-geocode.
 */

export interface GeocodeBackfillOptions {
  /** Default true — resolve addresses but write nothing. Only `false`
   *  persists lat/lng to the Tenant row. */
  dryRun?: boolean;
  /** Cap on how many eligible tenants a single invocation will process.
   *  Keeps one call from running away across a large fleet or hammering
   *  the geocode provider. Default 50. */
  limit?: number;
  /** Optional — restrict the run to a single tenant (useful for retrying
   *  a specific tenant that failed in a larger batch). */
  tenantId?: string;
  /** Who triggered a real (non-dry-run) run, for the AuditLog row. */
  actorUserId?: string;
}

export interface GeocodeBackfillDetail {
  tenantId: string;
  name: string;
  address: string;
  status: 'geocoded' | 'would_geocode' | 'skipped' | 'failed';
  latitude?: number;
  longitude?: number;
  source?: string;
  reason?: string;
}

export interface GeocodeBackfillSummary {
  dryRun: boolean;
  /** Total tenants matching the base eligibility filter (address set,
   *  lat/lng both null) in the WHOLE fleet, ignoring `limit` — a separate
   *  `count()` against the same WHERE used for `findMany`. Lets a dry-run
   *  operator see the true remaining-work population, not just the size
   *  of the page this call happened to pull. */
  totalCandidates: number;
  /** Tenants matching the base filter (address set, lat/lng both null),
   *  before the `limit` cap was applied. */
  scanned: number;
  /** Tenants actually attempted this run (scanned, capped by `limit`). */
  eligible: number;
  /** Successfully geocoded AND written (dryRun:false only). */
  geocoded: number;
  /** Successfully geocoded but NOT written because dryRun:true. */
  wouldGeocode: number;
  /** Already had lat/lng, or address too short/blank — not attempted. */
  skipped: number;
  /** Geocode call ran but returned no confident result, or threw. */
  failed: number;
  details: GeocodeBackfillDetail[];
}

/** Thrown when a second `run()` is invoked while one is already in flight.
 *  Controller maps this to HTTP 409 with a stable `code`. */
export class GeocodeBackfillAlreadyRunningError extends Error {
  readonly code = 'GEOCODE_BACKFILL_ALREADY_RUNNING' as const;
  constructor() {
    super('A geocode backfill run is already in progress. Wait for it to finish before starting another.');
    this.name = 'GeocodeBackfillAlreadyRunningError';
  }
}

@Injectable()
export class GeocodeBackfillService {
  private readonly logger = new Logger(GeocodeBackfillService.name);

  /** Small delay between provider calls so a big backfill doesn't hammer
   *  Google/Census/Nominatim in a tight loop. Nominatim's usage policy in
   *  particular asks for ≤1 req/sec from a single client. */
  private static readonly DELAY_MS = 1100;

  /** Batch size for DB reads — irrelevant to correctness, just keeps any
   *  single findMany() call bounded even if `limit` is set high. */
  private static readonly BATCH_SIZE = 20;

  /** Single-flight lock (module-level, process-wide). Adversarial review
   *  flagged that nothing stopped two concurrent invocations from each
   *  fanning out a full sweep against the same eligible-tenant page —
   *  wasteful at best (duplicate provider calls) and, since Prisma
   *  `findMany`+`update` here isn't done inside a single atomic
   *  transaction per row, a source of avoidable double-processing at
   *  worst. A plain boolean is sufficient: this is a manually-triggered,
   *  SUPER_ADMIN-only maintenance action (never called concurrently by
   *  normal app traffic), a single API replica handles it, and the
   *  window a real bug could slip through (two SUPER_ADMINs racing the
   *  same POST within the same process) is not worth a distributed
   *  Redis lock. We deliberately lock BOTH dry-run and real invocations
   *  (not just non-dry-run) — simpler to reason about than a partial
   *  lock, and a concurrent dry-run still duplicates provider calls and
   *  wastes rate-limit headroom even though it writes nothing. Released
   *  in a `finally` so a mid-run throw can never wedge the service. */
  private static isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
  ) {}

  async run(opts: GeocodeBackfillOptions = {}): Promise<GeocodeBackfillSummary> {
    if (GeocodeBackfillService.isRunning) {
      throw new GeocodeBackfillAlreadyRunningError();
    }
    GeocodeBackfillService.isRunning = true;
    try {
      return await this.runLocked(opts);
    } finally {
      GeocodeBackfillService.isRunning = false;
    }
  }

  private async runLocked(opts: GeocodeBackfillOptions): Promise<GeocodeBackfillSummary> {
    const dryRun = opts.dryRun !== false; // default true — safest default
    const limit = this.sanitizeLimit(opts.limit);

    const where: Record<string, unknown> = {
      address: { not: null },
      latitude: null,
      longitude: null,
    };
    if (opts.tenantId) where.id = opts.tenantId;

    // Accurate reporting (adversarial review): a dry-run operator needs to
    // see the TRUE remaining-work population, not just the limit-capped
    // page size `scanned` reflects. Same WHERE as the findMany below, run
    // as a count() so it's cheap regardless of fleet size.
    const totalCandidates = await this.prisma.client.tenant.count({ where: where as any });

    // Only need enough rows to satisfy `limit`; `scanned` reports the
    // capped page size actually pulled (not the full-fleet count).
    const candidates = await this.prisma.client.tenant.findMany({
      where: where as any,
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    const summary: GeocodeBackfillSummary = {
      dryRun,
      totalCandidates,
      scanned: candidates.length,
      eligible: 0,
      geocoded: 0,
      wouldGeocode: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    // Defense-in-depth: even though the WHERE clause already filters
    // lat/lng null, re-check per-row (idempotent even if called with a
    // stale/hand-built `where`) and skip blank addresses.
    const eligible = candidates.filter((t) => {
      const hasCoords = t.latitude != null && t.longitude != null;
      const hasAddress = !!(t.address && t.address.trim().length >= 3);
      if (hasCoords) {
        summary.skipped++;
        summary.details.push({
          tenantId: t.id,
          name: t.name,
          address: t.address ?? '',
          status: 'skipped',
          reason: 'already_has_coordinates',
        });
        return false;
      }
      if (!hasAddress) {
        summary.skipped++;
        summary.details.push({
          tenantId: t.id,
          name: t.name,
          address: t.address ?? '',
          status: 'skipped',
          reason: 'address_missing_or_too_short',
        });
        return false;
      }
      return true;
    });
    summary.eligible = eligible.length;

    for (let i = 0; i < eligible.length; i += GeocodeBackfillService.BATCH_SIZE) {
      const batch = eligible.slice(i, i + GeocodeBackfillService.BATCH_SIZE);
      for (let j = 0; j < batch.length; j++) {
        const tenant = batch[j];
        await this.processOne(tenant, dryRun, summary);
        // Rate-limit: pause between provider calls. Skip the delay after
        // the very last item so a run doesn't pay a trailing wait for
        // nothing. Nit fix (adversarial review): the old
        // `eligible.indexOf(tenant)` did an O(n) linear scan per item
        // (O(n²) overall) AND was fragile if `eligible` ever contained
        // duplicate-identity rows (indexOf would always resolve to the
        // FIRST match, not the current one) — the loop index comparison
        // below is O(1) and unambiguous.
        const isLast = i + j === eligible.length - 1;
        if (!isLast) {
          await this.sleep(GeocodeBackfillService.DELAY_MS);
        }
      }
    }

    if (!dryRun && summary.geocoded > 0) {
      await this.audit(opts.actorUserId, summary);
    }

    return summary;
  }

  private async processOne(
    tenant: { id: string; name: string; address: string | null },
    dryRun: boolean,
    summary: GeocodeBackfillSummary,
  ): Promise<void> {
    const address = tenant.address as string;
    try {
      const hits = await this.geocoding.search(address, { limit: 1 });
      const top = hits[0];
      if (!top) {
        summary.failed++;
        summary.details.push({
          tenantId: tenant.id,
          name: tenant.name,
          address,
          status: 'failed',
          reason: 'no_geocode_match',
        });
        return;
      }
      const lat = Number(top.lat);
      const lng = Number(top.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        summary.failed++;
        summary.details.push({
          tenantId: tenant.id,
          name: tenant.name,
          address,
          status: 'failed',
          reason: 'non_numeric_coordinates_returned',
        });
        return;
      }

      // MUST-FIX (adversarial review): enforce the SAME lat/lng range
      // invariant the rest of the app enforces on Tenant.latitude/longitude
      // (see apps/api/src/tenants/tenants.controller.ts — `latitude >= -90
      // && <= 90`, `longitude >= -180 && <= 180`). This is the only
      // data-corruption path in this service: a misbehaving/garbage
      // provider response could otherwise get written straight to the
      // Tenant row. Because the eligibility WHERE clause is
      // `latitude IS NULL`, a bad write here is STICKY — the tenant would
      // never be picked up by a re-run to self-heal. Reject before ever
      // reaching `tenant.update`.
      //
      // Exact `(0, 0)` — "null island" — is also rejected even though it
      // is technically in-range: it's the canonical low-confidence/garbage
      // result a geocoder returns when it silently failed to parse an
      // address (or a caller fat-fingered a numeric-string default), and a
      // real Tenant is never actually sited there.
      const isNullIsland = lat === 0 && lng === 0;
      const outOfRange = Math.abs(lat) > 90 || Math.abs(lng) > 180;
      if (outOfRange || isNullIsland) {
        summary.failed++;
        summary.details.push({
          tenantId: tenant.id,
          name: tenant.name,
          address,
          status: 'failed',
          reason: isNullIsland ? 'coordinates_null_island' : 'coordinates_out_of_range',
        });
        this.logger.warn(
          `geocode-backfill: tenant ${tenant.id} geocode result rejected (${
            isNullIsland ? 'null island' : 'out of range'
          }): lat=${lat} lng=${lng}`,
        );
        return;
      }

      if (dryRun) {
        summary.wouldGeocode++;
        summary.details.push({
          tenantId: tenant.id,
          name: tenant.name,
          address,
          status: 'would_geocode',
          latitude: lat,
          longitude: lng,
          source: top.source,
        });
        return;
      }

      await this.prisma.client.tenant.update({
        where: { id: tenant.id },
        data: { latitude: lat, longitude: lng },
      });
      summary.geocoded++;
      summary.details.push({
        tenantId: tenant.id,
        name: tenant.name,
        address,
        status: 'geocoded',
        latitude: lat,
        longitude: lng,
        source: top.source,
      });
    } catch (err: any) {
      // RESILIENT: one tenant's failure never aborts the batch.
      this.logger.warn(
        `geocode-backfill: tenant ${tenant.id} failed: ${err?.message || err}`,
      );
      summary.failed++;
      summary.details.push({
        tenantId: tenant.id,
        name: tenant.name,
        address,
        status: 'failed',
        reason: err?.message || 'geocode_threw',
      });
    }
  }

  private sanitizeLimit(limit?: number): number {
    // Bounded (adversarial review) so a single synchronous invocation can
    // never approach the platform request-timeout edge (Railway's ~300s
    // no-bytes cutoff). At the ~1.1s/tenant DELAY_MS pacing, 50 tenants is
    // ~55s of geocode-provider round trips plus per-tenant overhead — well
    // inside the window with headroom for provider latency spikes. This is
    // NOT an async-job conversion; it's a hard ceiling that makes one call
    // safe to run synchronously. Large fleets: call the (idempotent)
    // endpoint repeatedly — see the runbook doc.
    const DEFAULT = 25;
    const MAX = 50; // hard ceiling regardless of caller input
    if (limit == null || !Number.isFinite(limit)) return DEFAULT;
    const n = Math.floor(limit);
    if (n <= 0) return DEFAULT;
    return Math.min(n, MAX);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** AuditLog has a required (non-null) tenantId FK, so a fleet-wide
   *  backfill — which by definition touches many tenants at once — can't
   *  attribute a single row to one tenant. We write one AuditLog row per
   *  tenant actually geocoded (mirrors how POS/branding services audit
   *  per-affected-row), tagged with the run's shared summary counts so
   *  each row is independently useful AND the whole run is reconstructable
   *  by filtering on `action`. Failures inside audit-writing are caught +
   *  logged, never thrown — an audit hiccup must not undo/fail a
   *  successful geocode write (same pattern as PosService.audit).
   */
  private async audit(
    actorUserId: string | undefined,
    summary: GeocodeBackfillSummary,
  ): Promise<void> {
    const geocodedRows = summary.details.filter((d) => d.status === 'geocoded');
    for (const row of geocodedRows) {
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: row.tenantId,
            userId: actorUserId ?? null,
            action: 'GEOCODE_BACKFILL',
            targetType: 'Tenant',
            targetId: row.tenantId,
            details: JSON.stringify({
              address: row.address,
              latitude: row.latitude,
              longitude: row.longitude,
              source: row.source,
              runSummary: {
                scanned: summary.scanned,
                eligible: summary.eligible,
                geocoded: summary.geocoded,
                skipped: summary.skipped,
                failed: summary.failed,
              },
            }),
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `geocode-backfill: audit write failed for tenant ${row.tenantId}: ${err?.message || err}`,
        );
      }
    }
  }
}
