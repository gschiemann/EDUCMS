import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SportsService } from './sports.service';
import { type CommandInput, resolveCommandContext } from './game-command';
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

  /**
   * K12-F34 (the A1 convention for a non-command game action): the event
   * and its immutable audit row commit TOGETHER or not at all, and both name
   * the actor — who decided what the public may see about students, and
   * when.
   */
  async set(
    tenantId: string,
    gameId: string,
    actor: CommandInput,
    body: unknown,
  ): Promise<RosterPrivacy> {
    await this.sports.assertGameOwned(tenantId, gameId);
    const policy = parseRosterPrivacy(body);
    const ctx = resolveCommandContext(actor);
    const userId =
      ctx.actor.kind === 'user' ? (ctx.actor.userId ?? null) : null;
    await this.prisma.client.$transaction(async (tx: any) => {
      const ev = await tx.gameEvent.create({
        data: {
          gameId,
          type: ROSTER_PRIVACY_EVENT,
          payload: policy as unknown as object,
          actorType: ctx.actor.kind,
          actorUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'SPORTS_ROSTER_PRIVACY_SET',
          targetType: 'Game',
          targetId: gameId,
          details: JSON.stringify({
            ...policy,
            eventId: ev.id,
            actor: { type: ctx.actor.kind, ref: ctx.actor.ref ?? null },
          }),
        },
      });
    });
    // The public board payload is memoised for at most 1 s
    // (SportsService.BOARD_CACHE_TTL_MS), so the change reaches every
    // screen on its next poll without a separate invalidation hook.
    return policy;
  }
}
