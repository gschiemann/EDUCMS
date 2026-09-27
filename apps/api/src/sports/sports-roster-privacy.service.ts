import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SportsService } from './sports.service';
import {
  ROSTER_PRIVACY_EVENT,
  parseRosterPrivacy,
  type RosterPrivacy,
} from './roster-privacy';

/**
 * Read / write a game's public roster visibility (K-12 launch audit F38).
 * The policy itself — and why it is enforced in the public board payload —
 * is documented in ./roster-privacy.ts.
 *
 * Tenant scope: every call first runs `SportsService.assertGameOwned`
 * (a `{ id, tenantId }` lookup that 404s a foreign game), so a tenant-A
 * operator can neither read nor write a tenant-B game's setting. The
 * GameEvent rows carry no tenant column of their own; they are reached only
 * through a game id that has just been proven to belong to the caller.
 */
@Injectable()
export class SportsRosterPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sports: SportsService,
  ) {}

  async get(tenantId: string, gameId: string): Promise<RosterPrivacy> {
    await this.sports.assertGameOwned(tenantId, gameId);
    const latest = await this.prisma.client.gameEvent.findFirst({
      where: { gameId, type: ROSTER_PRIVACY_EVENT },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    return parseRosterPrivacy(latest?.payload);
  }

  async set(
    tenantId: string,
    gameId: string,
    userId: string | null,
    body: unknown,
  ): Promise<RosterPrivacy> {
    await this.sports.assertGameOwned(tenantId, gameId);
    const policy = parseRosterPrivacy(body);
    await this.prisma.client.gameEvent.create({
      data: {
        gameId,
        type: ROSTER_PRIVACY_EVENT,
        payload: policy as unknown as object,
      },
    });
    // Who decided what the public may see about students, and when —
    // immutable, like every other privileged sports action.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        userId: userId ?? null,
        action: 'SPORTS_ROSTER_PRIVACY_SET',
        targetType: 'Game',
        targetId: gameId,
        details: JSON.stringify(policy),
      },
    });
    // The public board payload is memoised for at most 1 s
    // (SportsService.BOARD_CACHE_TTL_MS), so the change reaches every
    // screen on its next poll without a separate invalidation hook.
    return policy;
  }
}
