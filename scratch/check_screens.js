const { PrismaClient } = require('@cms/database');
const prisma = new PrismaClient();

async function run() {
  const screens = await prisma.screen.findMany({});
  console.log('Total Screens:', screens.length);
  for (const s of screens) {
    console.log(`- ${s.id} | ${s.name} | Tenant: ${s.tenantId} | Group: ${s.screenGroupId}`);
  }
  const groups = await prisma.screenGroup.findMany({ include: { screens: true }});
  console.log('\nTotal Groups:', groups.length);
  for (const g of groups) {
    console.log(`- ${g.id} | ${g.name} | Screens: ${g.screens.length}`);
  }
  await prisma.$disconnect();
}
run();
