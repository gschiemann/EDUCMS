const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ATHLETICS_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1080 1920' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='bgGrad' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%' stop-color='%23111827'/>
        <stop offset='100%' stop-color='%23000000'/>
      </linearGradient>
      <!-- Spotlights -->
      <linearGradient id='spotL' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='%23FFFFFF' stop-opacity='0.15'/>
        <stop offset='100%' stop-color='%23FFFFFF' stop-opacity='0'/>
      </linearGradient>
      <linearGradient id='spotR' x1='1' y1='0' x2='0' y2='1'>
        <stop offset='0%' stop-color='%23FFFFFF' stop-opacity='0.15'/>
        <stop offset='100%' stop-color='%23FFFFFF' stop-opacity='0'/>
      </linearGradient>
      <!-- Metallic Hex/Dot Pattern (simple) -->
      <pattern id='dots' width='20' height='20' patternUnits='userSpaceOnUse'>
        <circle cx='2' cy='2' r='2' fill='%23ffffff' opacity='0.03'/>
      </pattern>
    </defs>
    <!-- Dark background -->
    <rect width='1080' height='1920' fill='url(%23bgGrad)'/>
    <!-- Dot matrix texture -->
    <rect width='1080' height='1920' fill='url(%23dots)'/>
    <!-- Dramatic stadium lights from top corners -->
    <polygon points='-200,-100 600,1920 0,1920' fill='url(%23spotL)' style='mix-blend-mode: overlay;'/>
    <polygon points='1280,-100 480,1920 1080,1920' fill='url(%23spotR)' style='mix-blend-mode: overlay;'/>
    <!-- Neon glowing accents at the top/bottom -->
    <rect x='0' y='0' width='1080' height='8' fill='%23EF4444' opacity='0.8'/>
    <rect x='0' y='1912' width='1080' height='8' fill='%23EF4444' opacity='0.8'/>
    <rect x='0' y='0' width='8' height='1920' fill='%233B82F6' opacity='0.5'/>
    <rect x='1072' y='0' width='8' height='1920' fill='%233B82F6' opacity='0.5'/>
  </svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #0F172A`;
})();

async function main() {
  const templates = await prisma.template.findMany({
    where: { name: { contains: "Athletics" } }
  });

  console.log(`Found ${templates.length} templates.`);

  const idealZones = [
    {
      name: 'Team Logo',
      widgetType: 'LOGO',
      x: 10, y: 3, width: 80, height: 16,
      sortOrder: 0,
      defaultConfig: JSON.stringify({ theme: 'high-school-athletics', initials: 'HS' }),
    },
    {
      name: 'Next Game Countdown',
      widgetType: 'COUNTDOWN',
      x: 5, y: 22, width: 90, height: 26,
      sortOrder: 1,
      defaultConfig: JSON.stringify({
        theme: 'high-school-athletics',
        label: 'TIP-OFF IN',
        targetDate: '',
        showDays: true,
        showHours: true,
      }),
    },
    {
      name: 'Game Recap Matchup',
      widgetType: 'ANNOUNCEMENT',
      x: 5, y: 52, width: 90, height: 24,
      sortOrder: 2,
      defaultConfig: JSON.stringify({
        theme: 'high-school-athletics',
        title: 'FINAL SCORE',
        message: 'EAGLES: 42\nRIVALS: 28',
      }),
    },
    {
      name: 'Hype Announcement',
      widgetType: 'TEXT',
      x: 5, y: 80, width: 90, height: 8,
      sortOrder: 3,
      defaultConfig: JSON.stringify({
        theme: 'high-school-athletics',
        content: 'BACK-TO-BACK STATE CHAMPS! 🏆',
        alignment: 'center',
      }),
    },
    {
      name: 'Fan Ticker',
      widgetType: 'TICKER',
      x: 0, y: 92, width: 100, height: 8,
      sortOrder: 4,
      defaultConfig: JSON.stringify({
        theme: 'high-school-athletics',
        speed: 'fast',
        messages: [
          'GO EAGLES! 🦅 Make some noise!',
          'Wear your school colors to the next home game!',
          'Student section doors open 30 minutes before tip-off',
        ],
      }),
    },
  ];

  for (const t of templates) {
    console.log(`Upgrading ${t.name}...`);
    await prisma.template.update({
      where: { id: t.id },
      data: { 
        name: '🏆 High School Athletics Jumbotron',
        bgGradient: ATHLETICS_BG,
        bgColor: null,
      }
    });

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

main().catch(console.error).finally(() => prisma.$disconnect());
