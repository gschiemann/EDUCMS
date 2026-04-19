import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { prisma } from '@cms/database';

/**
 * PrismaService — wraps the Prisma client with NestJS lifecycle hooks.
 *
 * onModuleInit was previously calling `$connect()` eagerly and AWAITING it.
 * If the DB was unreachable at boot (transient Supabase blip, Vercel/Railway
 * deploying before pgbouncer is ready, CI smoke test with no DB available),
 * the entire bootstrap crashed with `PrismaClientInitializationError P1001`
 * and the container died. Prisma already lazy-connects on first query, so
 * the eager $connect was unnecessary AND dangerous.
 *
 * Now: $connect runs in the background, with a hard 5s timeout, and any
 * failure is logged but does NOT prevent the API from coming up. The /health
 * endpoint already reports degraded DB cleanly — that's the right place for
 * downstream-failure visibility, not a crashloop at boot.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public client = prisma;

  async onModuleInit() {
    // Fire-and-forget warmup with a hard timeout. Don't await — the API
    // must come up regardless of DB reachability so /health can report
    // status and Vercel/Railway healthchecks stay green.
    Promise.race([
      this.client.$connect(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('prisma $connect timeout after 5s')), 5000),
      ),
    ])
      .then(() => this.logger.log('Prisma connected'))
      .catch((err) =>
        this.logger.warn(`Prisma initial connect failed (will lazy-connect on first query): ${err.message}`),
      );
  }

  async onModuleDestroy() {
    try {
      await this.client.$disconnect();
    } catch {
      // ignore — shutdown is best-effort
    }
  }
}
