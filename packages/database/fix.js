const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function fix() {
  const templates = await prisma.template.findMany({
    where: { name: { contains: "Middle School Hall" } },
    include: { zones: true }
  });
  
  const idealZones = [
    { name: 'Hall Ticker', widgetType: 'TICKER', x: 0, y: 0, width: 100, height: 8, sortOrder: 0, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', speed: 'medium', messages: ['Spirit Week: dress-up themes posted on the main office door', 'Science fair projects due next Friday', 'No phones in hallways — keep them in your locker'] }) },
    { name: 'Wall Clock', widgetType: 'CLOCK', x: 15.6, y: 11, width: 15.6, height: 16, sortOrder: 1, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', format: '12h', showSeconds: false }) },
    { name: 'Bell Schedule', widgetType: 'BELL_SCHEDULE', x: 54, y: 25, width: 14, height: 42, sortOrder: 2, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', showCurrentHighlight: true }) },
    { name: 'Hallway Photos', widgetType: 'IMAGE_CAROUSEL', x: 72, y: 24, width: 16, height: 22, sortOrder: 3, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', title: 'Spirit Week' }) },
    { name: 'Staff Spotlight', widgetType: 'STAFF_SPOTLIGHT', x: 72, y: 48, width: 16, height: 24, sortOrder: 4, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', staffName: 'Mr. Davis', role: 'Teacher of the Month' }) },
    { name: 'Locker Flyer', widgetType: 'ANNOUNCEMENT', x: 18.2, y: 42, width: 10.4, height: 18, sortOrder: 5, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', title: 'Tryouts Today!', message: 'Varsity Soccer @ 3:30 PM on the lower field.' }) },
    { name: 'Locker Weather', widgetType: 'WEATHER', x: 45.5, y: 45, width: 5.5, height: 14, sortOrder: 6, defaultConfig: JSON.stringify({ theme: 'middle-school-hall', tempF: 72, condition: 'Sunny' }) }
  ];

  for (const t of templates) {
    console.log(`Fixing custom template: ${t.id} (${t.name})`);
    await prisma.templateZone.deleteMany({ where: { templateId: t.id } });
    for (const z of idealZones) {
      await prisma.templateZone.create({
        data: {
          templateId: t.id,
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex || 0, sortOrder: z.sortOrder,
          defaultConfig: z.defaultConfig
        }
      });
    }
  }
}
fix().catch(console.error).finally(() => prisma.$disconnect());
