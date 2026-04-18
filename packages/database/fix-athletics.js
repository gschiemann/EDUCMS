const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find all templates that were generated from the High School Athletics template.
  // The system preset has id 'preset-high-school-athletics', but older ones might be 'high-school-athletics-scoreboard'.
  // Also any custom user templates with a similar name.
  const templates = await prisma.template.findMany({
    where: { name: { contains: "Athletics Scoreboard" } },
    include: { zones: true }
  });
  
  const jumbotronTemplates = await prisma.template.findMany({
    where: { name: { contains: "Athletics Jumbotron" } },
    include: { zones: true }
  });

  const allTemplates = [...templates, ...jumbotronTemplates];

  console.log(`Found ${allTemplates.length} templates to upgrade to the Jumbotron theme.`);

  const idealZones = [
    // TEAM LOGO
    {
      name: 'Team Logo',
      widgetType: 'LOGO',
      x: 10, y: 3, width: 80, height: 16,
      sortOrder: 0,
      defaultConfig: JSON.stringify({ theme: 'high-school-athletics', initials: 'HS' }),
    },
    // COUNTDOWN
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
    // SCORE / MATCHUP CARD
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
    // HYPE TEXT
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
    // LED MATRIX TICKER
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

  for (const t of allTemplates) {
    console.log(`Upgrading template: ${t.id} (${t.name})`);
    
    // Rename if it's the old name
    if (t.name === 'High School Athletics Scoreboard') {
      await prisma.template.update({
        where: { id: t.id },
        data: { name: '🏆 High School Athletics Jumbotron' }
      });
    }

    // Delete existing zones
    await prisma.templateZone.deleteMany({
      where: { templateId: t.id }
    });

    // Recreate them with the new configuration
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

  console.log('✅ High School Athletics Jumbotron upgrade complete!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
