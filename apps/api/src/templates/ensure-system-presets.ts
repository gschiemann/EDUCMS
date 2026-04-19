import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';

/**
 * Idempotent system-preset seeder. Runs once on API startup.
 *
 * When we add a new preset to system-presets.ts (e.g. the 2026-04-19
 * middle/high-school animated welcome scenes), the in-memory catalog
 * picks it up immediately — but the templates gallery fetches from the
 * DB (GET /templates with isSystem:true), so nothing shows up until
 * somebody re-runs the seed script. Nobody remembers to do that.
 *
 * This function reconciles the two on every boot:
 *
 *   1. Find every preset in SYSTEM_TEMPLATE_PRESETS that does NOT have
 *      a matching Template row (match by id).
 *   2. Create those rows + zones in a single transaction.
 *
 * It does NOT touch existing presets — we never silently rewrite a
 * customer-visible template just because the source changed. If we
 * deliberately want to update an existing preset we'd cut a separate
 * migration for it. This is purely additive.
 *
 * Called from main.ts after the Prisma pool warms up. Non-blocking —
 * failures are logged and swallowed so a broken preset can't wedge the
 * container. Boot health is gated on /health, not on seed success.
 */
export async function ensureSystemPresets(prisma: PrismaService) {
  const logger = new Logger('SystemPresetSeed');

  // Multi-pod boot race: two Railway replicas coming up at the same time
  // would both see "missing preset X" and both try to create it,
  // producing a P2002 unique-violation. A Postgres advisory lock
  // serializes the window; on non-PG engines the call no-ops.
  let haveLock = false;
  try {
    await prisma.client.$queryRaw`SELECT pg_advisory_lock(424242)`;
    haveLock = true;
  } catch {
    /* non-fatal on non-PG */
  }

  try {
    const existingIds = new Set(
      (await prisma.client.template.findMany({
        where: { isSystem: true },
        select: { id: true },
      })).map((r: { id: string }) => r.id),
    );

    const missing = SYSTEM_TEMPLATE_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length === 0) {
      logger.log(`All ${SYSTEM_TEMPLATE_PRESETS.length} system presets present.`);
      return;
    }

    logger.log(`Seeding ${missing.length} missing system preset(s)…`);
    let created = 0;
    for (const preset of missing) {
      try {
        await prisma.client.template.create({
          data: {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            category: preset.category as any,
            orientation: preset.orientation as any,
            // schoolLevel is optional on older presets — only pass when set
            ...(('schoolLevel' in preset && (preset as any).schoolLevel)
              ? { schoolLevel: (preset as any).schoolLevel }
              : {}),
            screenWidth: preset.screenWidth,
            screenHeight: preset.screenHeight,
            bgColor: preset.bgColor,
            bgGradient: preset.bgGradient,
            bgImage: (preset as any).bgImage ?? null,
            isSystem: true,
            status: 'ACTIVE' as any,
            tenantId: null,
            zones: {
              create: preset.zones.map((z: any, i: number) => ({
                name: z.name,
                widgetType: z.widgetType,
                x: z.x,
                y: z.y,
                width: z.width,
                height: z.height,
                zIndex: z.zIndex ?? 0,
                sortOrder: z.sortOrder ?? i,
                defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
              })),
            },
          },
        });
        created += 1;
        logger.log(`  + ${preset.name} (${preset.id})`);
      } catch (e) {
        const code = (e as any)?.code;
        if (code === 'P2002') {
          // Another pod won the race — harmless, they inserted the same row.
          logger.log(`  = ${preset.id} already created by another pod (P2002)`);
        } else {
          // One bad preset doesn't stop the rest. Loud log so we fix it.
          logger.warn(`  ✕ Failed to seed ${preset.id}: ${(e as Error).message}`);
        }
      }
    }
    logger.log(`System preset seed complete — ${created}/${missing.length} created.`);

    // Pin the curated animated-welcome set to the TOP of the gallery by
    // refreshing their updatedAt. The templates list orders by
    // (isSystem desc, updatedAt desc), so touching these pushes the
    // elementary / middle / high animated scenes above every other
    // system template as a cluster. Rerun this whenever we want the
    // "featured" set to surface first — cheap UPDATE, idempotent.
    const PINNED_TO_TOP = [
      'preset-cafeteria-animated-elementary',
      'preset-lobby-animated-high',
      'preset-lobby-animated-middle',
      'preset-lobby-animated-rainbow',
    ];
    try {
      for (const id of PINNED_TO_TOP) {
        await prisma.client.template.updateMany({
          where: { id, isSystem: true },
          data: { updatedAt: new Date() },
        });
      }
      logger.log(`Pinned ${PINNED_TO_TOP.length} animated-welcome presets to top of gallery.`);
    } catch (e) {
      logger.warn(`Pin-to-top failed: ${(e as Error).message}`);
    }
  } catch (e) {
    logger.warn(`System preset seed failed (continuing anyway): ${(e as Error).message}`);
  } finally {
    if (haveLock) {
      try {
        await prisma.client.$queryRaw`SELECT pg_advisory_unlock(424242)`;
      } catch {
        /* best-effort release; lock auto-releases on session end */
      }
    }
  }
}
