const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTemplates() {
  const custom = await prisma.template.findMany({
    where: { isSystem: false },
    include: { zones: true }
  });
  console.log(`Found ${custom.length} custom templates`);
  custom.forEach(t => {
    console.log(`- ${t.name} (id: ${t.id})`);
    if (t.id === 'library-quiet-zone' || t.name.includes('Library') || t.name.includes('Music') || t.name.includes('STEM')) {
      console.log('  Zones:', t.zones.map(z => z.widgetType));
    }
  });

  const system = await prisma.template.findMany({
    where: { isSystem: true }
  });
  console.log(`\nFound ${system.length} system templates`);
  system.forEach(t => {
    console.log(`- ${t.name} (id: ${t.id})`);
  });
}

checkTemplates().finally(() => prisma.$disconnect());
