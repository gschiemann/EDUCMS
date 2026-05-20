import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';
import { FITNESS_TEMPLATE_PRESETS } from './fitness-presets';
import { RESTAURANT_TEMPLATE_PRESETS } from './restaurant-presets';
import { BAR_TEMPLATE_PRESETS } from './bar-presets';
import { RETAIL_TEMPLATE_PRESETS } from './retail-presets';
import { SPORTS_TEMPLATE_PRESETS } from './sports-presets';

// Fitness presets live in their own file so the EDU pack stays
// uncontaminated. At seed time we tag each row with the vertical it
// was designed for (Template.vertical column); the templates list
// endpoint then filters by the requesting tenant's Tenant.vertical
// so a gym never sees K-12 templates and a school never sees fitness
// ones. `ALL_PRESETS` is the union we reconcile against the DB; the
// per-preset vertical is resolved via the map below.
const ALL_PRESETS = [
  ...SYSTEM_TEMPLATE_PRESETS,
  ...FITNESS_TEMPLATE_PRESETS,
  ...RESTAURANT_TEMPLATE_PRESETS,
  ...BAR_TEMPLATE_PRESETS,
  ...RETAIL_TEMPLATE_PRESETS,
  ...SPORTS_TEMPLATE_PRESETS,
];
const PRESET_VERTICAL: Map<string, string> = new Map();
SYSTEM_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'K12'));
// 2026-05-02 — VenueOS launch verticals are K12 / GYM / RETAIL /
// CORPORATE / QSR / FASHION (per packages/api-types/src/verticals.ts).
// The earlier sprint-plan name 'FITNESS' is unified to 'GYM' so the
// templates show up for tenants with Tenant.vertical = 'GYM'. The
// fitness-presets.ts file keeps its own internal name + category
// strings as 'FITNESS' for backward-compat in any dashboard chrome
// that already references that label; only the per-template VERTICAL
// flag below is what gates visibility per tenant. Existing tenants
// with Tenant.vertical = 'FITNESS' (if any) keep working — adding
// 'GYM' is purely additive on the seed side.
FITNESS_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'GYM'));
// Restaurant / QSR vertical (2026-05-02 launch). Quick-service menu
// boards, drive-thru displays, loyalty boards, wait-time displays.
// Tagged with vertical='QSR' so QSR-tenant catalogs surface them and
// no other vertical does. RESTAURANT remains valid as a forward-
// compat tag per verticals.ts comment but QSR is the canonical
// launch vertical (per packages/api-types/src/verticals.ts).
RESTAURANT_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'QSR'));
// Bar / nightlife / sports-pub vertical (2026-05-02 launch). Taproom +
// cocktail menu + game day + happy hour + live event + trivia. Tagged
// 'BAR' so bar tenants see this catalog and no other vertical does.
BAR_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'BAR'));
// Retail vertical (2026-05-02 launch). Editorial / boutique /
// department-store visual DNA — kept separate from the K12 + GYM
// packs so each vertical can ship templates without crosstalk.
RETAIL_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'RETAIL'));
// Sports vertical (2026-05-17). Starter set of full-screen celebration
// scenes + a game-day countdown. Tagged 'SPORTS' so VenueOS Sports
// tenants finally have a non-empty template gallery; scoreboard +
// ribbon templates follow once their widget set lands.
SPORTS_TEMPLATE_PRESETS.forEach((p) => PRESET_VERTICAL.set(p.id, 'SPORTS'));

// 2026-05-19 — the Main Scoreboard preset lives in the GENERAL
// SYSTEM_TEMPLATE_PRESETS array (it's a multi-vertical template surface,
// not part of the SPORTS_TEMPLATE_PRESETS celebration starter set), so
// the K12 default above tagged it K12 → invisible to the SPORTS-vertical
// "dodgers" tenant where the operator was testing. It is a sports
// surface; tag it SPORTS so it surfaces in the sports gallery. The
// boot-time metadata-sync pass below migrates any existing row's
// vertical to match this map, and a fresh id (preset-main-scoreboard,
// renamed from preset-std-scoreboard) guarantees a clean single-zone
// create rather than inheriting the old row's 7 stale zones.
// 2026-05-20 — scoreboard presets re-cut with fresh ids (preset-sb-main
// = element-based composable board; preset-sb-quick = one-piece monolith)
// because the boot seed can't rewrite an existing preset's MULTI-zone
// composition — only a fresh id forces a clean create. The old
// preset-main-scoreboard / preset-elements-scoreboard drop from source
// and the seed's archive pass hides them.
PRESET_VERTICAL.set('preset-sb-main', 'SPORTS');
PRESET_VERTICAL.set('preset-sb-quick', 'SPORTS');
PRESET_VERTICAL.set('preset-main-ribbon', 'SPORTS');
PRESET_VERTICAL.set('preset-main-scorebug', 'SPORTS');

// 2026-05-16 — the 70-template industry signage pack (preset-sig-*)
// lives INSIDE SYSTEM_TEMPLATE_PRESETS so it shares the seeder, which
// means the K12 default above tagged every one of them 'K12'. They
// are NOT K12. Re-tag each by the industry encoded in its id
// (`preset-sig-<industry>-NN`) so a school never sees a drive-thru
// menu board and a bar never sees a bell schedule. The 8 preset-hs-*
// templates ARE high-school and correctly keep the K12 tag.
const SIG_INDUSTRY_VERTICAL: Record<string, string> = {
  bar: 'BAR',
  corporate: 'CORPORATE',
  fashion: 'FASHION',
  healthcare: 'HEALTHCARE',
  hospitality: 'HOSPITALITY',
  'menus-pos': 'RESTAURANT',
  qsr: 'QSR',
};
SYSTEM_TEMPLATE_PRESETS.forEach((p) => {
  const m = p.id.match(/^preset-sig-(.+)-\d+$/);
  const industry = m?.[1];
  if (industry && SIG_INDUSTRY_VERTICAL[industry]) {
    PRESET_VERTICAL.set(p.id, SIG_INDUSTRY_VERTICAL[industry]);
  }
});

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

    // ─── Metadata sync for existing presets ───
    // The "creation only" contract above means a preset's schoolLevel
    // / category / name tag can drift from source forever once a row
    // exists. The Integration Lead reported Scrapbook + Storybook
    // (elementary aesthetic) showing up under the High School filter
    // because the DB rows are still tagged UNIVERSAL from an older
    // source version. Metadata tags ARE safe to rewrite — they only
    // affect which filter chip surfaces a preset, not what actually
    // renders — so we reconcile them here. Zones / defaultConfig /
    // screenWidth stay untouched; those are the "customer-visible
    // shape" the creation-only rule was written for.
    try {
      const presentRows = await prisma.client.template.findMany({
        where: {
          isSystem: true,
          id: { in: ALL_PRESETS.map((p) => p.id) },
        },
        select: { id: true, name: true, category: true, schoolLevel: true, description: true, vertical: true } as any,
      });
      let syncCount = 0;
      for (const row of presentRows as any[]) {
        const src: any = ALL_PRESETS.find((p) => p.id === row.id);
        if (!src) continue;
        const patch: Record<string, any> = {};
        if (src.name && src.name !== row.name) patch.name = src.name;
        if (src.category && src.category !== row.category) patch.category = src.category;
        if (src.description && src.description !== row.description) patch.description = src.description;
        const srcLevel = ('schoolLevel' in src && src.schoolLevel) ? src.schoolLevel : undefined;
        if (srcLevel && srcLevel !== row.schoolLevel) patch.schoolLevel = srcLevel;
        // 2026-05-03 — operator: "I logged in as the gym user and it's
        // all school still, I thought you loaded all the new templates
        // we created." Cause: existing fitness preset rows had been
        // seeded earlier with `vertical: 'FITNESS'`, but the templates
        // list endpoint queries by the new tag `vertical: 'GYM'` (per
        // the VenueOS rebrand). Those rows never matched the GYM
        // tenant's vertical filter so the catalog rendered empty.
        // Re-sync the vertical tag from the source map on every boot
        // so old rows migrate to the canonical vertical without
        // requiring a hand-rolled migration.
        const srcVertical = PRESET_VERTICAL.get(src.id) ?? 'K12';
        if (srcVertical !== row.vertical) patch.vertical = srcVertical;
        if (Object.keys(patch).length > 0) {
          await prisma.client.template.update({ where: { id: row.id }, data: patch });
          syncCount += 1;
        }
      }
      if (syncCount > 0) {
        logger.log(`Synced metadata on ${syncCount} existing system preset(s).`);
      }
    } catch (e) {
      logger.warn(`Metadata sync failed: ${(e as Error).message}`);
    }

    // ─── Zone widget-type sync ───
    // The metadata sync above only touches Template-level fields. When
    // we cut a new portrait widget (e.g. ANIMATED_HALLWAY_SCHEDULE_PORTRAIT)
    // and point the existing preset at it, the DB row's child zones
    // STILL hold the old widgetType ('ANIMATED_HALLWAY_SCHEDULE') and
    // the player keeps rendering the landscape widget.
    //
    // Rule: for every system preset whose source declares a single
    // full-canvas zone (one zone with widgetType X), force the DB
    // zone's widgetType to match the source. We only touch the FIRST
    // zone — if a preset has a multi-zone composition, hand-edits
    // there are sacred. Single-zone presets are the "themed widget"
    // class where the one widgetType is the entire thing.
    //
    // This is purely a SOURCE→DB push. If an admin somehow rewired a
    // system preset's zone via direct SQL it gets overwritten on next
    // boot — but system presets are read-only by contract so that's
    // the intended behavior.
    try {
      let zoneSyncCount = 0;
      let configSyncCount = 0;
      for (const src of ALL_PRESETS) {
        // Only touch single-zone presets — multi-zone compositions are
        // out of scope for this auto-sync (those would need per-zone
        // matching logic).
        if (!Array.isArray(src.zones) || src.zones.length !== 1) continue;
        const sourceWidgetType = (src.zones as any)[0]?.widgetType;
        if (!sourceWidgetType) continue;
        const updated = await prisma.client.templateZone.updateMany({
          where: {
            templateId: src.id,
            widgetType: { not: sourceWidgetType },
          },
          data: { widgetType: sourceWidgetType },
        });
        if (updated.count > 0) {
          zoneSyncCount += updated.count;
          logger.log(`  ↳ ${src.id}: zone widgetType → ${sourceWidgetType}`);
        }

        // 2026-05-16 — ALSO sync defaultConfig. Bug: the 8 HS presets
        // were repointed from HS_* widgets to EXTERNAL_HTML, but this
        // sync only updated widgetType — the existing zone's
        // defaultConfig stayed `{}` (the old HS presets shipped empty
        // config), so EXTERNAL_HTML rendered with no `url` → blank
        // preview. For single-zone system presets the source IS the
        // truth, so force the zone's defaultConfig to match. We
        // read-then-write only on a diff to stay idempotent + quiet.
        const wantConfig = (src.zones as any)[0]?.defaultConfig
          ? JSON.stringify((src.zones as any)[0].defaultConfig)
          : null;
        const zone = await prisma.client.templateZone.findFirst({
          where: { templateId: src.id },
          select: { id: true, defaultConfig: true },
        });
        if (zone && (zone.defaultConfig ?? null) !== wantConfig) {
          await prisma.client.templateZone.update({
            where: { id: zone.id },
            data: { defaultConfig: wantConfig },
          });
          configSyncCount += 1;
          logger.log(`  ↳ ${src.id}: zone defaultConfig synced`);
        }
      }
      if (zoneSyncCount > 0) {
        logger.log(`Synced widgetType on ${zoneSyncCount} system-preset zone(s).`);
      }
      if (configSyncCount > 0) {
        logger.log(`Synced defaultConfig on ${configSyncCount} system-preset zone(s).`);
      }
    } catch (e) {
      logger.warn(`Zone widgetType/config sync failed: ${(e as Error).message}`);
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
