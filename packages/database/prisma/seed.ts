import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Try to clean up
  await prisma.auditLog.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.playlistItem.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.screen.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  console.log('Seeding demo tenant...');
  
  const tenant = await prisma.tenant.create({
    data: {
      id: "00000000-0000-0000-0000-000000000000",
      name: "Springfield School District",
    }
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "admin@springfield.edu",
      passwordHash: "secure_hash",
      role: "SUPER_ADMIN"
    }
  });

  // Seed Screens
  for (let i = 0; i < 4; i++) {
    await prisma.screen.create({
      data: {
        tenantId: tenant.id,
        name: `Display ${i + 1}`,
        location: `Hallway ${i + 1}`,
        deviceFingerprint: `FINGERPRINT_${i}`,
        status: i === 3 ? "OFFLINE" : "ONLINE", // Example: leave one offline
      }
    });
  }

  // Seed Playlists
  for (let i = 0; i < 2; i++) {
    await prisma.playlist.create({
      data: {
        tenantId: tenant.id,
        name: `Morning Announcements V${i + 1}`,
      }
    });
  }

  // Seed Audit Logs
  const actions = ["Screen Provisioned", "Playlist Updated", "Emergency Clear"];
  for (let i = 0; i < 5; i++) {
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: actions[i % actions.length],
        targetType: "System",
        details: { note: "Seeded event" }
      }
    });
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
