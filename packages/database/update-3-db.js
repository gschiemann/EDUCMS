const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updates = [
    { sysId: 'preset-office-dashboard', theme: 'office-dashboard' },
    { sysId: 'gym-pe-display', theme: 'gym-pe' },
    { sysId: 'principals-office-welcome', theme: 'principals-office' }
  ];

  for (const u of updates) {
    const zones = await prisma.templateZone.findMany({ where: { templateId: u.sysId } });
    for (const z of zones) {
      let config = {};
      try {
        config = JSON.parse(z.defaultConfig || '{}');
      } catch (e) {}
      
      config.theme = u.theme;
      
      await prisma.templateZone.update({
        where: { id: z.id },
        data: { defaultConfig: JSON.stringify(config) }
      });
    }
    console.log(`Updated ${u.sysId} with theme: ${u.theme}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
