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

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
  ) {}

  async run(opts: GeocodeBackfillOptions = {}): Promise<GeocodeBackfillSummary> {
    const dryRun = opts.dryRun !== false; // default true — safest default
    const limit = this.sanitizeLimit(opts.limit);

    const where: Record<string, unknown> = {
      address: { not: null },
      latitude: null,
      longitude: null,
    };
    if (opts.tenantId) where.id = opts.tenantId;

    // Only need enough rows to satisfy `limit`; `scanned` reports the
    // capped page size actually pulled (not the full-fleet count) — cheap
    // and sufficient for a summary, avoids a second COUNT query.
    const candidates = await this.prisma.client.tenant.findMany({
      where: where as any,
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
      orderBy: { name: 'asc' },
      take: limit,
    });

    const summary: GeocodeBackfillSummary = {
      dryRun,
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
      for (const tenant of batch) {
        await this.processOne(tenant, dryRun, summary);
        // Rate-limit: pause between provider calls. Skip the delay after
        // the very last item so a run doesn't pay a trailing wait for
        // nothing.
        const isLast =
          eligible.indexOf(tenant) === eligible.length - 1;
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
    const DEFAULT = 50;
    const MAX = 500; // hard ceiling regardless of caller input
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
