import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SPONSOR_SPOT_SECONDS } from './sponsor.constants';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Sponsorship service.
 *
 * Sponsor CRUD plus TWO proof-of-play reports:
 *   - `report()`     — tenant-wide ARITHMETIC ESTIMATE, computed at read
 *     time from each game's live duration and the rotation cadence. No
 *     impression rows needed; honest "Estimated" number for a quick glance.
 *   - `gameReport()` — REAL per-game, per-surface counts aggregated from
 *     the `SponsorImpression` rows the public board/ribbon write as a
 *     sponsor look enters view (see `recordImpression`). This is the
 *     proof-of-play that closes a renewal: "your logo ran 41× on the
 *     ribbon, 28× on the board," with a per-sponsor cap-compliance flag.
 */

interface SponsorInput {
  name?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  tier?: string | null;
  weight?: number;
  active?: boolean;
  /** ISO-8601 string or Date — null clears the bound. */
  flightStartAt?: string | Date | null;
  flightEndAt?: string | Date | null;
  /** Max airings per hour; null or undefined = uncapped. */
  frequencyCapPerHour?: number | null;
}

@Injectable()
export class SponsorsService {
  private readonly auditLogger = new Logger('SponsorsService');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * P0-4 (2026-05-28) — write a sponsor mutation to the immutable
   * AuditLog. Sponsor rows are ad-inventory / revenue config that the
   * proof-of-play billing report depends on; before this, sponsor CRUD
   * wrote ZERO audit rows, so a bad actor could silently rewrite or
   * delete ad inventory with no trail tying it to a user.
   *
   * Best-effort (a DB hiccup must never fail the operator's save) but
   * NOT silent — a write failure logs at warn. `AuditLog.tenantId` is
   * NOT NULL; every sponsor mutation is tenant-scoped so it is always
   * known. `actorUserId` is optional only because the per-impression
   * public path has no user — the three CRUD callers always supply it.
   */
  private async audit(
    tenantId: string,
    actorUserId: string | null | undefined,
    action: 'SPONSOR_CREATED' | 'SPONSOR_UPDATED' | 'SPONSOR_DELETED',
    sponsorId: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action,
          targetType: 'Sponsor',
          targetId: sponsorId,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.auditLogger.warn(`audit(${action}, ${sponsorId}) failed: ${e?.message ?? e}`);
    }
  }

  // ── helpers ──────────────────────────────────────────────────

  private clean(value: unknown, max: number): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s ? s.slice(0, max) : null;
  }

  private clampWeight(value: unknown, fallback = 1): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(10, Math.max(1, Math.round(n)));
  }

  private async owned(tenantId: string, id: string) {
    const sponsor = await this.prisma.client.sponsor.findFirst({
      where: { id, tenantId },
    });
    if (!sponsor) throw new NotFoundException('Sponsor not found');
    return sponsor;
  }

  // ── helpers ──────────────────────────────────────────────────

  /**
   * Parse a flight boundary input — accepts an ISO string, a Date, or
   * null/undefined. Returns a Date for Prisma (null when clearing).
   */
  private cleanFlightDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Clamp frequencyCapPerHour to a valid positive integer, or null. */
  private cleanFreqCap(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const clamped = Math.max(1, Math.min(9999, Math.round(n)));
    return clamped;
  }

  // ── CRUD ─────────────────────────────────────────────────────

  /** Every sponsor for a tenant — heaviest rotation weight first. */
  list(tenantId: string) {
    return this.prisma.client.sponsor.findMany({
      where: { tenantId },
      orderBy: [{ weight: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Active sponsors at the current moment — used by the public board
   * response so the scoreboard banner only ever shows in-flight ads.
   * A sponsor is active when:
   *   - `active` is true (or the column defaults to true), AND
   *   - flightStartAt is null OR <= now, AND
   *   - flightEndAt   is null OR >= now.
   */
  listActive(tenantId: string) {
    const now = new Date();
    return this.prisma.client.sponsor.findMany({
      where: {
        tenantId,
        active: true,
        OR: [{ flightStartAt: null }, { flightStartAt: { lte: now } }],
        AND: [
          {
            OR: [{ flightEndAt: null }, { flightEndAt: { gte: now } }],
          },
        ],
      },
      orderBy: [{ weight: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tagline: true,
        color: true,
        weight: true,
        // T2-9: needed client-side for frequency-cap enforcement + flight
        // window re-check (the board page filters these every rotation tick
        // so a sponsor whose flight ends mid-game stops airing immediately).
        frequencyCapPerHour: true,
        flightEndAt: true,
      },
    });
  }

  async create(tenantId: string, dto: SponsorInput, actorUserId?: string) {
    const name = this.clean(dto.name, 120);
    if (!name) throw new BadRequestException('Sponsor name is required');

    const sponsor = await this.prisma.client.sponsor.create({
      data: {
        tenantId,
        name,
        logoUrl: this.clean(dto.logoUrl, 2048),
        tagline: this.clean(dto.tagline, 160),
        color: this.clean(dto.color, 32),
        tier: this.clean(dto.tier, 40),
        weight: this.clampWeight(dto.weight),
        active: dto.active === undefined ? true : !!dto.active,
        flightStartAt: dto.flightStartAt !== undefined ? this.cleanFlightDate(dto.flightStartAt) : null,
        flightEndAt: dto.flightEndAt !== undefined ? this.cleanFlightDate(dto.flightEndAt) : null,
        frequencyCapPerHour: dto.frequencyCapPerHour !== undefined ? this.cleanFreqCap(dto.frequencyCapPerHour) : null,
      },
    });
    await this.audit(tenantId, actorUserId, 'SPONSOR_CREATED', sponsor.id, {
      name: sponsor.name,
      tier: sponsor.tier,
      weight: sponsor.weight,
      active: sponsor.active,
    });
    return sponsor;
  }

  async update(tenantId: string, id: string, dto: SponsorInput, actorUserId?: string) {
    const current = await this.owned(tenantId, id);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = this.clean(dto.name, 120);
      if (!name) throw new BadRequestException('Sponsor name cannot be empty');
      data.name = name;
    }
    if (dto.logoUrl !== undefined) data.logoUrl = this.clean(dto.logoUrl, 2048);
    if (dto.tagline !== undefined) data.tagline = this.clean(dto.tagline, 160);
    if (dto.color !== undefined) data.color = this.clean(dto.color, 32);
    if (dto.tier !== undefined) data.tier = this.clean(dto.tier, 40);
    if (dto.weight !== undefined) data.weight = this.clampWeight(dto.weight, current.weight);
    if (dto.active !== undefined) data.active = !!dto.active;
    if (dto.flightStartAt !== undefined) data.flightStartAt = this.cleanFlightDate(dto.flightStartAt);
    if (dto.flightEndAt !== undefined) data.flightEndAt = this.cleanFlightDate(dto.flightEndAt);
    if (dto.frequencyCapPerHour !== undefined) data.frequencyCapPerHour = this.cleanFreqCap(dto.frequencyCapPerHour);

    const updated = await this.prisma.client.sponsor.update({ where: { id }, data });
    await this.audit(tenantId, actorUserId, 'SPONSOR_UPDATED', id, {
      name: updated.name,
      // keys only — records which inventory fields the operator touched
      // (weight / flight window / active state are the billing-relevant
      // ones) without bloating the row with logo URLs.
      changedFields: Object.keys(data),
    });
    return updated;
  }

  async remove(tenantId: string, id: string, actorUserId?: string) {
    // Capture the name BEFORE delete so the audit row is meaningful
    // after the row is gone ("Operator X deleted sponsor 'Acme Co').
    const existing = await this.owned(tenantId, id);
    await this.prisma.client.sponsor.delete({ where: { id } });
    await this.audit(tenantId, actorUserId, 'SPONSOR_DELETED', id, {
      name: existing.name,
      tier: existing.tier,
    });
    return { deleted: true };
  }

  // ── per-impression write-through ────────────────────────────

  /**
   * T2-9: Record a real sponsor impression.
   *
   * Called fire-and-forget from board / ribbon / scorebug pages each time
   * a sponsor look enters view. High write volume during games — kept
   * lightweight: two cheap indexed point-reads + one INSERT, no audit-log
   * write (sponsor proof-of-play is the audit surface here, not a security
   * event).
   *
   * PUBLIC-ROUTE HARDENING (P0, 2026-05-28). This is reachable WITHOUT auth
   * (the un-guarded `:sponsorId/impression` route), so it must not let an
   * anonymous caller forge cross-tenant rows. We resolve both the sponsor
   * and the game and only write when they belong to the SAME tenant:
   *   - unknown sponsorId → no row (the sponsor lookup misses);
   *   - unknown gameId    → no row (the game lookup misses);
   *   - sponsor.tenant ≠ game.tenant → no row (cross-tenant forgery).
   * All three are silent (no error to the caller) so a stale rotation-ref
   * or a probe never throws a 500 onto the public board. The only thing a
   * caller who already knows a game's unguessable UUID can do is inflate
   * that game's own counts with that tenant's own sponsors.
   */
  async recordImpression(sponsorId: string, gameId: string, surfaceKind: string): Promise<void> {
    const safe = String(surfaceKind || 'board').slice(0, 16);
    if (!sponsorId || !gameId) return;
    try {
      // Resolve tenant for each side. Both reads hit a primary-key /
      // indexed lookup; selecting only tenantId keeps them tiny.
      const [sponsor, game] = await Promise.all([
        this.prisma.client.sponsor.findUnique({
          where: { id: sponsorId },
          select: { tenantId: true },
        }),
        this.prisma.client.game.findUnique({
          where: { id: gameId },
          select: { tenantId: true },
        }),
      ]);
      // Reject unknown ids and any cross-tenant pairing.
      if (!sponsor || !game || sponsor.tenantId !== game.tenantId) return;

      await this.prisma.client.sponsorImpression.create({
        data: { sponsorId, gameId, surfaceKind: safe },
      });
    } catch {
      // Best-effort — a missing sponsor FK, a dropped write, a transient
      // pool hiccup: none of these should bubble up to the public surface.
    }
  }

  /**
   * T2-9: Per-game sponsor report — real impression counts per surface.
   *
   * Returns aggregated counts from `SponsorImpression` so the operator
   * can ship a sponsor a real proof-of-play PDF: "your logo ran 41 times
   * on the ribbon and 28 times on the board during Friday's game."
   *
   * Also includes a `capCompliant` flag: compares actual total impressions
   * against `cap × gameDurationHours` so a Title sponsor at 12/hr doesn't
   * sneak over the line undetected.
   */
  async gameReport(tenantId: string, gameId: string) {
    // Verify the game belongs to this tenant before returning data.
    const game = await this.prisma.client.game.findFirst({
      where: { id: gameId, tenantId },
      select: { id: true, startedAt: true, endedAt: true, status: true, updatedAt: true },
    });
    if (!game) return null;

    const impressions = await this.prisma.client.sponsorImpression.findMany({
      where: { gameId },
      select: { sponsorId: true, surfaceKind: true },
    });

    const sponsors = await this.prisma.client.sponsor.findMany({
      where: { tenantId },
      select: { id: true, name: true, frequencyCapPerHour: true },
    });

    // Compute game duration in hours for cap compliance check.
    const now = Date.now();
    let gameDurationMs = 0;
    if (game.startedAt) {
      const start = new Date(game.startedAt).getTime();
      const end = game.endedAt
        ? new Date(game.endedAt).getTime()
        : game.status === 'FINAL'
          ? new Date(game.updatedAt).getTime()
          : now;
      gameDurationMs = Math.max(0, end - start);
    }
    const gameDurationMin = Math.round(gameDurationMs / 60_000);
    const gameDurationHours = gameDurationMs / 3_600_000;

    // Aggregate per sponsor × surface.
    //
    // FIX 3 (P0, 2026-05-28) — only `board` + `ribbon` are real sponsor
    // surfaces. The broadcast scorebug overlay (apps/web/src/app/scorebug)
    // is a tight transparent OBS bug that renders NO sponsor and fires NO
    // impression, so a `scorebug` column was permanently 0 — a dishonest
    // "we measure this" costume. It's dropped from the report. Any stray
    // `scorebug` row (e.g. a future surface or an external poster) is still
    // counted toward `total` so a number is never silently lost, but we no
    // longer advertise a per-scorebug column that nothing fills.
    const counts = new Map<string, { board: number; ribbon: number; other: number }>();
    for (const imp of impressions) {
      if (!counts.has(imp.sponsorId)) {
        counts.set(imp.sponsorId, { board: 0, ribbon: 0, other: 0 });
      }
      const entry = counts.get(imp.sponsorId)!;
      if (imp.surfaceKind === 'board') entry.board++;
      else if (imp.surfaceKind === 'ribbon') entry.ribbon++;
      else entry.other++;
    }

    const sponsorRows = sponsors.map((s) => {
      const c = counts.get(s.id) ?? { board: 0, ribbon: 0, other: 0 };
      const total = c.board + c.ribbon + c.other;
      const allowedTotal =
        s.frequencyCapPerHour !== null && s.frequencyCapPerHour !== undefined && gameDurationHours > 0
          ? Math.ceil(s.frequencyCapPerHour * gameDurationHours)
          : null;
      const capCompliant = allowedTotal === null ? true : total <= allowedTotal;
      return {
        sponsorId: s.id,
        name: s.name,
        board: c.board,
        ribbon: c.ribbon,
        total,
        capCompliant,
      };
    });

    return {
      gameId,
      gameStartedAt: game.startedAt,
      gameDurationMin,
      sponsors: sponsorRows,
    };
  }

  // ── proof of play ────────────────────────────────────────────

  /**
   * Estimated spots + exposure per sponsor. The scoreboard banner
   * cycles through one stats card + one slot per sponsor weight, each
   * slot held for SPONSOR_SPOT_SECONDS. Over a game's live duration
   * that's `liveSeconds / cycleSeconds` cycles; each sponsor is shown
   * `weight` times per cycle. We sum live time across every game the
   * tenant has run.
   */
  async report(tenantId: string) {
    const [sponsors, games] = await Promise.all([
      this.prisma.client.sponsor.findMany({
        where: { tenantId },
        orderBy: [{ weight: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.client.game.findMany({
        where: { tenantId, startedAt: { not: null } },
        select: { startedAt: true, endedAt: true, status: true, updatedAt: true },
      }),
    ]);

    const now = Date.now();
    let totalLiveMs = 0;
    for (const g of games) {
      if (!g.startedAt) continue;
      const start = new Date(g.startedAt).getTime();
      // Finished games use endedAt; a game still in progress counts up
      // to now; a FINAL game that somehow lacks endedAt falls back to
      // updatedAt (its last mutation ≈ when it went final) so the
      // sponsor exposure isn't silently dropped to zero.
      const end = g.endedAt
        ? new Date(g.endedAt).getTime()
        : g.status === 'FINAL'
          ? new Date(g.updatedAt).getTime()
          : now;
      totalLiveMs += Math.max(0, end - start);
    }
    const totalLiveSeconds = Math.floor(totalLiveMs / 1000);

    const active = sponsors.filter((s) => s.active);
    const totalWeight = active.reduce((sum, s) => sum + Math.max(1, s.weight), 0);
    // cycle = 1 stats slot + one slot per unit of sponsor weight.
    const cycleSeconds = (1 + totalWeight) * SPONSOR_SPOT_SECONDS;
    const cycles = cycleSeconds > 0 ? totalLiveSeconds / cycleSeconds : 0;

    return {
      spotSeconds: SPONSOR_SPOT_SECONDS,
      totalGames: games.length,
      totalLiveSeconds,
      sponsors: sponsors.map((s) => {
        const spots = s.active ? Math.round(cycles * Math.max(1, s.weight)) : 0;
        return {
          id: s.id,
          name: s.name,
          tier: s.tier,
          weight: s.weight,
          active: s.active,
          estimatedSpots: spots,
          estimatedExposureSeconds: spots * SPONSOR_SPOT_SECONDS,
        };
      }),
    };
  }
}
