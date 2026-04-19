import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SYSTEM_TEMPLATE_PRESETS } from '../../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'admin123';

async function main() {
  // ─────────────────────────────────────────────────────
  // SAFETY GATE — preserve tenant work on every seed run.
  // ─────────────────────────────────────────────────────
  // The original script unconditionally deleted EVERY template (system
  // AND tenant-built), every playlist, every asset, every user, every
  // tenant — wiping months of operator work on every `pnpm db:seed`.
  // That repeated nuke is what kept eating your custom templates.
  //
  // New default: REFRESH-ONLY. Re-upserts the system template presets
  // and creates the demo tenant/users only if they don't already
  // exist. Custom (`isSystem = false`) templates, playlists, schedules,
  // assets, screens, audit log entries, and notifications are left
  // strictly alone.
  //
  // To get the old destructive behavior (e.g. when explicitly setting
  // up a fresh dev DB) set `SEED_FULL_RESET=true` on the command line.
  const fullReset = process.env.SEED_FULL_RESET === 'true';

  if (fullReset) {
    console.warn('⚠️  SEED_FULL_RESET=true — wiping ALL tenant data including custom templates.');
    await prisma.templateZone.deleteMany();
    await prisma.template.deleteMany();
    // AuditLog is immutable append-only. NEVER wipe in prod, and honor an
    // explicit PRESERVE_AUDIT opt-out even in dev (e.g. debugging against a
    // shared/prod-like DB where someone set NODE_ENV=development). Defense
    // in depth: two independent env checks before any destructive delete.
    if (process.env.NODE_ENV !== 'production' && !process.env.PRESERVE_AUDIT) {
      await prisma.auditLog.deleteMany();
    } else {
      console.log('[seed] skipping auditLog.deleteMany (NODE_ENV=prod or PRESERVE_AUDIT=1)');
    }
    await prisma.schedule.deleteMany();
    await prisma.playlistItem.deleteMany();
    await prisma.playlist.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.assetFolder.deleteMany();
    await prisma.screen.deleteMany();
    await prisma.screenGroup.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
  } else {
    // Refresh-only: drop ONLY system template zones + system templates.
    // Custom (tenant-built) templates and EVERYTHING ELSE are preserved.
    const systemTemplates = await prisma.template.findMany({
      where: { isSystem: true },
      select: { id: true },
    });
    const systemTemplateIds = systemTemplates.map((t) => t.id);
    if (systemTemplateIds.length > 0) {
      await prisma.templateZone.deleteMany({ where: { templateId: { in: systemTemplateIds } } });
      await prisma.template.deleteMany({ where: { id: { in: systemTemplateIds } } });
    }
    console.log(`Refresh-only mode: preserved all custom templates + tenant data. Dropping ${systemTemplateIds.length} stale system presets to re-upsert.`);
  }

  console.log('Seeding demo tenant (idempotent)...');

  // Hash the seed password once (Argon2id is expensive).
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Idempotent upsert. If the tenant / users / starter playlists already
  // exist the seed leaves them unchanged. Without this the script
  // crashed on re-run because of unique-constraint violations.
  const district = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Springfield School District',
      slug: 'springfield-district',
    },
  });
  const school = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Springfield Elementary',
      slug: 'springfield-elementary',
      parentId: district.id,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@springfield.edu' },
    update: {}, // never reset a real admin's password from seed
    create: {
      tenantId: school.id,
      email: 'admin@springfield.edu',
      passwordHash,
      role: 'SUPER_ADMIN',
    },
  });
  await prisma.user.upsert({
    where: { email: 'teacher@springfield.edu' },
    update: {},
    create: {
      tenantId: school.id,
      email: 'teacher@springfield.edu',
      passwordHash,
      role: 'CONTRIBUTOR',
    },
  });

  console.log(`  Admin: admin@springfield.edu / ${SEED_PASSWORD} (preserved if already set)`);
  console.log(`  Teacher: teacher@springfield.edu / ${SEED_PASSWORD} (preserved if already set)`);

  // Starter playlists: only create if NONE exist for this tenant. Once
  // an operator has built any real playlists, leave them alone.
  const existingPlaylistCount = await prisma.playlist.count({ where: { tenantId: school.id } });
  if (existingPlaylistCount === 0) {
    await prisma.playlist.createMany({
      data: [
        { tenantId: school.id, name: 'Morning Announcements' },
        { tenantId: school.id, name: 'Lunch Menu Display' },
      ],
    });
    console.log('  Seeded 2 empty starter playlists.');
  } else {
    console.log(`  Skipped starter playlists (tenant already has ${existingPlaylistCount}).`);
  }

  // No seed assets — users upload their own content via the UI.
  // Playlists are created empty and populated through the playlist editor.

  // Seed audit logs
  const actions = [
    { action: "USER_LOGIN", targetType: "User", details: { email: "admin@springfield.edu" } },
    { action: "SCREEN_PROVISIONED", targetType: "Screen", details: { name: "Display 1" } },
    { action: "SYSTEM_INITIALIZED", targetType: "System", details: { note: "Seed data loaded" } },
  ];

  for (const log of actions) {
    await prisma.auditLog.create({
      data: {
        tenantId: school.id,
        userId: admin.id,
        action: log.action,
        targetType: log.targetType,
        details: JSON.stringify(log.details),
      }
    });
  }

  // ─────────────────────────────────────────────────────
  // Seed system template presets
  // ─────────────────────────────────────────────────────
  console.log('Seeding system template presets...');

  // Re-create each system preset by id. The earlier deleteMany already
  // cleared the old system rows; this loop just recreates them.
  // Custom (tenant-built) templates are NOT touched.
  for (const preset of SYSTEM_TEMPLATE_PRESETS) {
    await prisma.template.create({
      data: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        category: preset.category,
        orientation: preset.orientation,
        schoolLevel: preset.schoolLevel ?? 'UNIVERSAL',
        screenWidth: preset.screenWidth,
        screenHeight: preset.screenHeight,
        bgColor: preset.bgColor,
        bgGradient: preset.bgGradient,
        bgImage: preset.bgImage,
        isSystem: true,
        status: 'ACTIVE',
        tenantId: null,
        zones: {
          create: preset.zones.map((z, i) => ({
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
  }

  console.log(`  Templates: ${SYSTEM_TEMPLATE_PRESETS.length} system presets seeded`);

  console.log('Seed completed successfully!');
  console.log(`  District: ${district.name}`);
  console.log(`  School: ${school.name}`);
  console.log(`  Screens: 0 (provision via player app)`);
  console.log(`  Playlists: 2 (empty — add content via the CMS)`);
  console.log(`  Assets: 0 (upload via Assets page)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
