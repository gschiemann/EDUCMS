const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding seamless template...');

  const preset = {
    id: 'preset-lobby-seamless-premium',
    name: '👑 Premium — Seamless Cutout',
    description: 'Ultra-modern, high-end display featuring the Seamless theme. Widgets drop their backgrounds and float perfectly over a rich, cinematic architectural backdrop. Ideal for premium lobbies and administrative buildings.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgImage: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=3840&auto=format&fit=crop',
    bgGradient: 'linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.9) 100%)',
    isSystem: true,
    status: 'PUBLISHED',
    zones: {
      create: [
        {
          name: 'School Logo',
          widgetType: 'LOGO',
          x: 4, y: 6, width: 15, height: 15,
          sortOrder: 0,
          defaultConfig: JSON.stringify({ fitMode: 'contain', theme: 'seamless', initials: 'HS' }),
        },
        {
          name: 'Welcome Headline',
          widgetType: 'TEXT',
          x: 22, y: 6, width: 50, height: 15,
          sortOrder: 1,
          defaultConfig: JSON.stringify({
            content: 'Welcome to Excellence',
            fontSize: 72,
            alignment: 'center',
            color: '#ffffff',
            theme: 'seamless',
          }),
        },
        {
          name: 'Clock',
          widgetType: 'CLOCK',
          x: 75, y: 6, width: 20, height: 15,
          sortOrder: 2,
          defaultConfig: JSON.stringify({
            format: '12h',
            theme: 'seamless',
            color: '#ffffff',
          }),
        },
        {
          name: 'Weather',
          widgetType: 'WEATHER',
          x: 4, y: 25, width: 20, height: 25,
          sortOrder: 3,
          defaultConfig: JSON.stringify({
            location: 'Springfield',
            units: 'imperial',
            theme: 'seamless',
          }),
        },
        {
          name: 'Important Announcement',
          widgetType: 'ANNOUNCEMENT',
          x: 28, y: 25, width: 44, height: 40,
          sortOrder: 4,
          defaultConfig: JSON.stringify({
            title: 'Innovation Summit 2026',
            message: 'Join us this evening in the main auditorium as our seniors present their capstone engineering and design projects. Doors open at 6:00 PM.',
            badgeLabel: 'Featured Event',
            theme: 'seamless',
          }),
        },
        {
          name: 'Event Countdown',
          widgetType: 'COUNTDOWN',
          x: 75, y: 25, width: 20, height: 25,
          sortOrder: 5,
          defaultConfig: JSON.stringify({
            label: 'Summit Begins In',
            targetDate: '',
            theme: 'seamless',
          }),
        },
        {
          name: 'High-End Visuals',
          widgetType: 'IMAGE_CAROUSEL',
          x: 28, y: 68, width: 44, height: 26,
          sortOrder: 6,
          defaultConfig: JSON.stringify({
            transitionEffect: 'fade',
            intervalMs: 8000,
            fitMode: 'cover',
            theme: 'seamless',
          }),
        },
        {
          name: 'Premium Ticker',
          widgetType: 'TICKER',
          x: 0, y: 94, width: 100, height: 6,
          sortOrder: 7,
          defaultConfig: JSON.stringify({
            speed: 'medium',
            messages: [
              'Empowering the leaders of tomorrow.',
              'Visit our new Science Wing.',
              'Registration for Fall 2026 is now open.'
            ],
            theme: 'seamless',
          }),
        },
      ]
    }
  };

  // Check if it exists
  const existing = await prisma.template.findUnique({
    where: { id: preset.id }
  });

  if (existing) {
    await prisma.template.delete({
      where: { id: preset.id }
    });
  }

  await prisma.template.create({
    data: preset
  });

  console.log('Seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
