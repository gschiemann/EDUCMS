import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { prisma } from '@cms/database';
import {
  bumpManifestContentRev,
  markManifestRevHookArmed,
  shouldBumpManifestRev,
} from '../screens/manifest-hot-cache';

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
  private playlistMetadataReady: Promise<void> | null = null;
  public client = prisma;

  async onModuleInit() {
    // Manifest content-rev hook (Supabase egress diet — 2026-07-30). Any
    // mutation on a model the player manifest reads invalidates every
    // cached manifest (screens/manifest-hot-cache.ts), so an operator edit
    // is visible on the very next poll — identical freshness to the
    // uncached path. Screen updates touching ONLY telemetry columns
    // (heartbeat lastPingAt, cache/render-proof reports) are excluded via
    // shouldBumpManifestRev, otherwise the fleet's own 25-30s telemetry
    // would thrash the cache. $use is deprecated-but-supported on Prisma
    // 5.22; if it ever disappears, arming fails gracefully and the cache
    // degrades to a 20s TTL — correctness NEVER depends on this hook.
    try {
      const useFn = (this.client as any).$use;
      if (typeof useFn === 'function') {
        useFn.call(this.client, async (params: any, next: (p: any) => Promise<any>) => {
          try {
            const data = params?.args?.data;
            const keys =
              data && typeof data === 'object' && !Array.isArray(data)
                ? Object.keys(data)
                : null;
            if (shouldBumpManifestRev(params?.model, params?.action, keys)) {
              bumpManifestContentRev();
            }
          } catch {
            // Cache accounting must never break a query.
          }
          return next(params);
        });
        markManifestRevHookArmed();
        this.logger.log('Manifest content-rev hook armed — mutation-busted manifest cache active');
      } else {
        this.logger.warn('Prisma $use unavailable — manifest cache degraded to short TTL');
      }
    } catch (err: any) {
      this.logger.warn(`Manifest content-rev hook failed to arm (${err?.message}) — manifest cache on short TTL`);
    }

    // Fire-and-forget warmup with a hard timeout. Don't await — the API
    // must come up regardless of DB reachability so /health can report
    // status and Vercel/Railway healthchecks stay green.
    Promise.race([
      this.client.$connect(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('prisma $connect timeout after 5s')), 5000),
      ),
    ])
      .then(() => {
        this.logger.log('Prisma connected');
        this.ensurePlaylistMetadataColumns().catch((err) =>
          this.logger.warn(`Playlist metadata schema warmup failed: ${err.message}`),
        );
      })
      .catch((err) =>
        this.logger.warn(`Prisma initial connect failed (will lazy-connect on first query): ${err.message}`),
      );
  }

  async ensurePlaylistMetadataColumns() {
    if (!this.playlistMetadataReady) {
      this.playlistMetadataReady = (async () => {
        await this.client.$executeRawUnsafe(`
          ALTER TABLE "playlists"
            ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT,
            ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        `);
        await this.client.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'playlists_created_by_user_id_fkey'
            ) THEN
              ALTER TABLE "playlists"
                ADD CONSTRAINT "playlists_created_by_user_id_fkey"
                FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
                ON DELETE SET NULL ON UPDATE CASCADE;
            END IF;
          END $$
        `);
        await this.client.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "playlists_tenant_id_updated_at_idx"
          ON "playlists"("tenant_id", "updated_at")
        `);
        await this.client.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "playlists_tenant_id_created_at_idx"
          ON "playlists"("tenant_id", "created_at")
        `);
        await this.client.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "playlists_created_by_user_id_idx"
          ON "playlists"("created_by_user_id")
        `);
      })().catch((err) => {
        this.playlistMetadataReady = null;
        throw err;
      });
    }

    return this.playlistMetadataReady;
  }

  async onModuleDestroy() {
    try {
      await this.client.$disconnect();
    } catch {
      // ignore — shutdown is best-effort
    }
  }
}
