import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';
import { FITNESS_TEMPLATE_PRESETS } from './fitness-presets';

// Fitness presets live in their own file so the EDU pack stays
// uncontaminated. At seed time we tag each row with the vertical it
// was designed for (Template.vertical column); the templates list
// endpoint then filters by the requesting tenant's Tenant.vertical
// so a gym never sees K-12 templates and a school never sees fitness
// ones. `ALL_PRESETS` is the union we reconcile against the DB; the
// per-preset vertical is resolved via the map below.
const ALL_PRESETS = [...SYSTEM_TEMPLATE_PRESETS, ...FITNESS_TEMPLATE_PRESETS];
const PRESET_VERTICAL: Map<string, string> = new Map();
SYSTEM_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'K12'));
FITNESS_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'FITNESS'));

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

    const missing = ALL_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length === 0) {
      logger.log(`All ${ALL_PRESETS.length} system presets present.`);
    } else {
      logger.log(`Seeding ${missing.length} missing system preset(s)…`);
    }
    // NOTE: do NOT early-return when missing.length===0. The archive
    // + pin passes below MUST run on every boot so deletions from
    // system-presets.ts propagate to the DB and the pin-to-top set
    // stays fresh.
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
            // Tag each preset with its vertical so the templates list
            // endpoint can filter it out for tenants in other verticals.
            vertical: PRESET_VERTICAL.get(preset.id) ?? 'K12',
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
    if (missing.length > 0) {
      logger.log(`System preset seed complete — ${created}/${missing.length} created.`);
    }

    // ─── Archive presets that were deleted from system-presets.ts or fitness-presets.ts ───
    // Source-of-truth is the ALL_PRESETS array. Any system
    // template row in the DB whose id no longer appears there gets
    // archived (status=ARCHIVED) so it disappears from the gallery
    // without breaking any playlist that already references it. We do
    // NOT hard-delete — a tenant playlist could still point at the old
    // template id, and the live manifest needs to keep rendering it
    // until the tenant rebuilds with the new set. Cascade-delete would
    // wipe content unexpectedly.
    const wantedIds = new Set(ALL_PRESETS.map((p) => p.id));
    try {
      const stale = await prisma.client.template.findMany({
        where: { isSystem: true, status: 'ACTIVE' as any },
        select: { id: true, name: true },
      });
      const toArchive = stale.filter((t: { id: string }) => !wantedIds.has(t.id));
      if (toArchive.length > 0) {
        await prisma.client.template.updateMany({
          where: { id: { in: toArchive.map((t: { id: string }) => t.id) } },
          data: { status: 'ARCHIVED' as any },
        });
        logger.log(`Archived ${toArchive.length} legacy system preset(s) no longer in source.`);
      }
    } catch (e) {
      logger.warn(`Archive pass failed: ${(e as Error).message}`);
    }

    // ─── Same-name duplicate cleanup ───
    // Operator reported seeing two system templates with identical
    // display names (e.g. "Varsity Athletics", "Campus Quad — Welcome")
    // in the gallery. Root cause: earlier seed runs inserted rows whose
    // ids have since been superseded by newer rewrites under different
    // ids. The archive pass above catches ids that are no longer in
    // source, but if both the old AND the new id survive in source
    // (or the operator manually created a clone), the gallery keeps
    // rendering both.
    //
    // Rule: for every (case-insensitive) duplicate name among ACTIVE
    // isSystem=true rows, keep the row whose id appears in the
    // canonical ALL_PRESETS list; if multiple match, keep the most
    // recently updated; archive the rest.
    try {
      const allActive = await prisma.client.template.findMany({
        where: { isSystem: true, status: 'ACTIVE' as any },
        select: { id: true, name: true, updatedAt: true },
      });
      const byName = new Map<string, { id: string; name: string; updatedAt: Date }[]>();
      for (const t of allActive) {
        const key = (t.name || '').trim().toLowerCase();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key)!.push(t);
      }
      const toArchive: string[] = [];
      for (const [name, rows] of byName) {
        if (rows.length < 2) continue;
        // Preferred winner: the row whose id is in ALL_PRESETS and has
        // the latest updatedAt. Everyone else in the group loses.
        const inSource = rows.filter((r) => wantedIds.has(r.id));
        const candidates = inSource.length > 0 ? inSource : rows;
        const keeper = candidates.slice().sort(
          (a, b) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0),
        )[0];
        for (const r of rows) {
          if (r.id !== keeper.id) toArchive.push(r.id);
        }
        logger.log(
          `Dedup "${name}": keeping ${keeper.id}, archiving ${rows.length - 1} twin(s)`,
        );
      }
      if (toArchive.length > 0) {
        await prisma.client.template.updateMany({
          where: { id: { in: toArchive } },
          data: { status: 'ARCHIVED' as any },
        });
        logger.log(`Archived ${toArchive.length} duplicate-name system preset(s).`);
      }
    } catch (e) {
      logger.warn(`Duplicate-name cleanup failed: ${(e as Error).message}`);
    }

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
