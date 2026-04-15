import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

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
    }
  });

  // Create school tenant under district
  const school = await prisma.tenant.create({
    data: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Springfield Elementary",
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

  const SYSTEM_PRESETS = [
    {
      id: 'preset-lobby-welcome',
      name: 'Lobby Welcome Board',
      description: 'Main entrance display with school logo, announcements, upcoming events, and a scrolling ticker.',
      category: 'LOBBY',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'School Logo', widgetType: 'LOGO', x: 0, y: 0, width: 25, height: 20, sortOrder: 0, defaultConfig: JSON.stringify({ fitMode: 'contain' }) },
        { name: 'Welcome Message', widgetType: 'TEXT', x: 25, y: 0, width: 50, height: 20, sortOrder: 1, defaultConfig: JSON.stringify({ content: 'Welcome to Our School!', fontSize: 36, alignment: 'center' }) },
        { name: 'Clock', widgetType: 'CLOCK', x: 75, y: 0, width: 25, height: 10, sortOrder: 2, defaultConfig: JSON.stringify({ format: '12h' }) },
        { name: 'Weather', widgetType: 'WEATHER', x: 75, y: 10, width: 25, height: 10, sortOrder: 3, defaultConfig: JSON.stringify({ units: 'imperial' }) },
        { name: 'Main Announcements', widgetType: 'ANNOUNCEMENT', x: 0, y: 20, width: 60, height: 70, sortOrder: 4 },
        { name: 'Upcoming Events', widgetType: 'CALENDAR', x: 60, y: 20, width: 40, height: 70, sortOrder: 5, defaultConfig: JSON.stringify({ daysToShow: 7 }) },
        { name: 'Bottom Ticker', widgetType: 'TICKER', x: 0, y: 90, width: 100, height: 10, sortOrder: 6, defaultConfig: JSON.stringify({ speed: 'medium' }) },
      ],
    },
    {
      id: 'preset-hallway-trizone',
      name: 'Hallway Tri-Zone',
      description: 'Three horizontal bands: header with logo/clock, large media area, and announcements.',
      category: 'HALLWAY',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'Logo', widgetType: 'LOGO', x: 0, y: 0, width: 20, height: 15, sortOrder: 0 },
        { name: 'Header Title', widgetType: 'TEXT', x: 20, y: 0, width: 60, height: 15, sortOrder: 1, defaultConfig: JSON.stringify({ content: 'Eagle News', fontSize: 28, alignment: 'center' }) },
        { name: 'Clock', widgetType: 'CLOCK', x: 80, y: 0, width: 20, height: 15, sortOrder: 2 },
        { name: 'Main Content', widgetType: 'IMAGE_CAROUSEL', x: 0, y: 15, width: 100, height: 60, sortOrder: 3, defaultConfig: JSON.stringify({ transitionEffect: 'slide', intervalMs: 6000 }) },
        { name: 'Bottom Announcements', widgetType: 'ANNOUNCEMENT', x: 0, y: 75, width: 100, height: 25, sortOrder: 4 },
      ],
    },
    {
      id: 'preset-cafeteria-menu',
      name: 'Cafeteria Menu Board',
      description: 'Lunch menu display with daily specials, food photos, and countdown to next period.',
      category: 'CAFETERIA',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'Header', widgetType: 'TEXT', x: 0, y: 0, width: 70, height: 12, sortOrder: 0, defaultConfig: JSON.stringify({ content: "Today's Menu", fontSize: 36, bgColor: '#2d5016', color: '#ffffff' }) },
        { name: 'Clock', widgetType: 'CLOCK', x: 70, y: 0, width: 30, height: 12, sortOrder: 1 },
        { name: 'Lunch Menu', widgetType: 'LUNCH_MENU', x: 0, y: 12, width: 55, height: 78, sortOrder: 2 },
        { name: 'Food Photos', widgetType: 'IMAGE_CAROUSEL', x: 55, y: 12, width: 45, height: 50, sortOrder: 3, defaultConfig: JSON.stringify({ transitionEffect: 'fade', intervalMs: 5000 }) },
        { name: 'Countdown', widgetType: 'COUNTDOWN', x: 55, y: 62, width: 45, height: 28, sortOrder: 4, defaultConfig: JSON.stringify({ label: 'Next lunch period in' }) },
        { name: 'Ticker', widgetType: 'TICKER', x: 0, y: 90, width: 100, height: 10, sortOrder: 5, defaultConfig: JSON.stringify({ speed: 'slow' }) },
      ],
    },
    {
      id: 'preset-classroom-daily',
      name: 'Classroom Daily Board',
      description: 'In-class display with bell schedule, daily agenda, and rotating photos.',
      category: 'CLASSROOM',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'Class Title', widgetType: 'TEXT', x: 0, y: 0, width: 75, height: 12, sortOrder: 0, defaultConfig: JSON.stringify({ content: 'Room 204', fontSize: 24 }) },
        { name: 'Clock', widgetType: 'CLOCK', x: 75, y: 0, width: 25, height: 12, sortOrder: 1, defaultConfig: JSON.stringify({ format: '12h', showSeconds: true }) },
        { name: 'Bell Schedule', widgetType: 'BELL_SCHEDULE', x: 0, y: 12, width: 30, height: 78, sortOrder: 2, defaultConfig: JSON.stringify({ showCurrentHighlight: true }) },
        { name: 'Daily Agenda', widgetType: 'RICH_TEXT', x: 30, y: 12, width: 40, height: 78, sortOrder: 3 },
        { name: 'Class Photos', widgetType: 'IMAGE_CAROUSEL', x: 70, y: 12, width: 30, height: 50, sortOrder: 4 },
        { name: 'Countdown', widgetType: 'COUNTDOWN', x: 70, y: 62, width: 30, height: 28, sortOrder: 5 },
        { name: 'Updates', widgetType: 'TICKER', x: 0, y: 90, width: 100, height: 10, sortOrder: 6 },
      ],
    },
    {
      id: 'preset-fullscreen-media',
      name: 'Full Screen Media',
      description: 'Simple full-screen layout for a single video, image, or slideshow.',
      category: 'CUSTOM',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'Full Screen', widgetType: 'IMAGE_CAROUSEL', x: 0, y: 0, width: 100, height: 100, sortOrder: 0, defaultConfig: JSON.stringify({ transitionEffect: 'fade', intervalMs: 8000 }) },
      ],
    },
    {
      id: 'preset-url-video-carousel',
      name: 'Web + Video + Photos',
      description: 'Three stacked zones: website on top, video in the middle, photo carousel on the bottom.',
      category: 'CUSTOM',
      orientation: 'LANDSCAPE',
      zones: [
        { name: 'Website', widgetType: 'WEBPAGE', x: 0, y: 0, width: 100, height: 30, sortOrder: 0 },
        { name: 'Video', widgetType: 'VIDEO', x: 0, y: 30, width: 100, height: 40, sortOrder: 1, defaultConfig: JSON.stringify({ autoplay: true, muted: false, loop: true }) },
        { name: 'Photo Carousel', widgetType: 'IMAGE_CAROUSEL', x: 0, y: 70, width: 100, height: 30, sortOrder: 2, defaultConfig: JSON.stringify({ transitionEffect: 'slide', intervalMs: 5000 }) },
      ],
    },
  ];

  for (const preset of SYSTEM_PRESETS) {
    await prisma.template.create({
      data: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        category: preset.category,
        orientation: preset.orientation,
        isSystem: true,
        status: 'ACTIVE',
        tenantId: null,
        zones: {
          create: preset.zones.map((z) => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            sortOrder: z.sortOrder,
            defaultConfig: z.defaultConfig || null,
          })),
        },
      },
    });
  }

  console.log(`  Templates: ${SYSTEM_PRESETS.length} system presets seeded`);

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
