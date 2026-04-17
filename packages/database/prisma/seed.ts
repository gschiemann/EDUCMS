import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SYSTEM_TEMPLATE_PRESETS } from '../../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'admin123';

async function main() {
  // Clean up existing data (order matters for foreign keys)
  await prisma.templateZone.deleteMany();
  await prisma.template.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.playlistItem.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetFolder.deleteMany();
  await prisma.screen.deleteMany();
  await prisma.screenGroup.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  console.log('Seeding demo tenant...');

  // Create district tenant
  const district = await prisma.tenant.create({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Springfield School District",
      slug: "springfield-district",
    }
  });

  // Create school tenant under district
  const school = await prisma.tenant.create({
    data: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Springfield Elementary",
      slug: "springfield-elementary",
      parentId: district.id,
    }
  });

  // Hash the seed password with Argon2id
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      tenantId: school.id,
      email: "admin@springfield.edu",
      passwordHash,
      role: "SUPER_ADMIN"
    }
  });

  // Create contributor user
  const teacher = await prisma.user.create({
    data: {
      tenantId: school.id,
      email: "teacher@springfield.edu",
      passwordHash,
      role: "CONTRIBUTOR"
    }
  });

  console.log(`  Admin: admin@springfield.edu / ${SEED_PASSWORD}`);
  console.log(`  Teacher: teacher@springfield.edu / ${SEED_PASSWORD}`);

  // No fake screens or groups — screens are provisioned via the player app.
  // Users create screen groups through the Screens page.

  // Seed empty playlists as starting points
  await prisma.playlist.create({
    data: {
      tenantId: school.id,
      name: "Morning Announcements",
    }
  });

  await prisma.playlist.create({
    data: {
      tenantId: school.id,
      name: "Lunch Menu Display",
    }
  });

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

  for (const preset of SYSTEM_TEMPLATE_PRESETS) {
    await prisma.template.create({
      data: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        category: preset.category,
        orientation: preset.orientation,
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
