import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SPONSOR_SPOT_SECONDS } from './sponsor.constants';

/**
 * VenueOS Sports — Sprint 13 Phase 2. Sponsorship service.
 *
 * Sponsor CRUD plus the proof-of-play report. The report is the part
 * that closes the ad sale — it tells a sponsor "your logo ran N spots
 * for M minutes of live game time." It is computed entirely at read
 * time from each game's live duration and the rotation cadence: no
 * per-impression rows, no write path from the public scoreboard.
 */

interface SponsorInput {
  name?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  tier?: string | null;
  weight?: number;
  active?: boolean;
}

@Injectable()
export class SponsorsService {
  constructor(private readonly prisma: PrismaService) {}

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

  // ── CRUD ─────────────────────────────────────────────────────

  /** Every sponsor for a tenant — heaviest rotation weight first. */
  list(tenantId: string) {
    return this.prisma.client.sponsor.findMany({
      where: { tenantId },
      orderBy: [{ weight: 'desc' }, { name: 'asc' }],
    });
  }

  async create(tenantId: string, dto: SponsorInput) {
    const name = this.clean(dto.name, 120);
    if (!name) throw new BadRequestException('Sponsor name is required');

    return this.prisma.client.sponsor.create({
      data: {
        tenantId,
        name,
        logoUrl: this.clean(dto.logoUrl, 2048),
        tagline: this.clean(dto.tagline, 160),
        color: this.clean(dto.color, 32),
        tier: this.clean(dto.tier, 40),
        weight: this.clampWeight(dto.weight),
        active: dto.active === undefined ? true : !!dto.active,
      },
    });
  }

  async update(tenantId: string, id: string, dto: SponsorInput) {
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

    return this.prisma.client.sponsor.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    await this.prisma.client.sponsor.delete({ where: { id } });
    return { deleted: true };
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
        select: { startedAt: true, endedAt: true, status: true },
      }),
    ]);

    const now = Date.now();
    let totalLiveMs = 0;
    for (const g of games) {
      if (!g.startedAt) continue;
      const start = new Date(g.startedAt).getTime();
      // Finished games use endedAt; a game still in progress counts up
      // to now; a FINAL game missing endedAt (shouldn't happen) is 0.
      const end = g.endedAt
        ? new Date(g.endedAt).getTime()
        : g.status === 'FINAL'
          ? start
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
