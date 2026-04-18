const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <!-- Deep architectural blue gradient background -->
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e3a8a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>

    <!-- Glowing light rays -->
    <linearGradient id="ray1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(56, 189, 248, 0.4)" />
      <stop offset="100%" stop-color="rgba(56, 189, 248, 0)" />
    </linearGradient>
    <linearGradient id="ray2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(129, 140, 248, 0.3)" />
      <stop offset="100%" stop-color="rgba(129, 140, 248, 0)" />
    </linearGradient>

    <!-- Frosted Glass Pattern -->
    <pattern id="gridPattern" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect x="0" y="0" width="80" height="80" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      <circle cx="80" cy="80" r="1.5" fill="rgba(255,255,255,0.1)" />
    </pattern>

    <!-- Noise Texture -->
    <filter id="noise">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
      <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.05 0" />
    </filter>
  </defs>

  <!-- Base background -->
  <rect width="1920" height="1080" fill="url(#bgGradient)" />

  <!-- Grid overlay -->
  <rect width="1920" height="1080" fill="url(#gridPattern)" />

  <!-- Diagonal architectural light rays -->
  <polygon points="0,0 800,0 1920,1080 0,1080" fill="url(#ray1)" />
  <polygon points="1920,0 1120,0 0,1080 1920,1080" fill="url(#ray2)" />

  <!-- Glowing Orbs (Abstract architecture) -->
  <circle cx="150" cy="150" r="300" fill="rgba(56, 189, 248, 0.15)" filter="blur(80px)" />
  <circle cx="1700" cy="900" r="400" fill="rgba(99, 102, 241, 0.15)" filter="blur(100px)" />

  <!-- Noise filter overlay -->
  <rect width="1920" height="1080" filter="url(#noise)" opacity="0.8" />
</svg>`;
  
  const bgImage = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const templateId = 'preset-lobby-welcome';

  await prisma.template.update({
    where: { id: templateId },
    data: {
      bgImage: bgImage,
      bgGradient: null,
      bgColor: null
    }
  });

  await prisma.templateZone.deleteMany({ where: { templateId } });

  const zones = [
    {
      name: 'School Logo',
      widgetType: 'LOGO',
      x: 3, y: 5, width: 20, height: 25,
      sortOrder: 0,
      defaultConfig: { theme: 'lobby-welcome', fitMode: 'contain' },
    },
    {
      name: 'Welcome Message',
      widgetType: 'TEXT',
      x: 25, y: 5, width: 50, height: 25,
      sortOrder: 1,
      defaultConfig: { theme: 'lobby-welcome', content: 'Welcome to Sunshine Academy! ☀️', fontSize: 36, alignment: 'center' },
    },
    {
      name: 'Clock',
      widgetType: 'CLOCK',
      x: 77, y: 5, width: 20, height: 12,
      sortOrder: 2,
      defaultConfig: { theme: 'lobby-welcome', format: '12h', showSeconds: false },
    },
    {
      name: 'Weather',
      widgetType: 'WEATHER',
      x: 77, y: 18, width: 20, height: 12,
      sortOrder: 3,
      defaultConfig: { theme: 'lobby-welcome', units: 'imperial', showForecast: false },
    },
    {
      name: 'Main Announcements',
      widgetType: 'ANNOUNCEMENT',
      x: 3, y: 33, width: 55, height: 50,
      sortOrder: 4,
      defaultConfig: { theme: 'lobby-welcome', priority: 'normal' },
    },
    {
      name: 'Upcoming Events',
      widgetType: 'CALENDAR',
      x: 60, y: 33, width: 37, height: 50,
      sortOrder: 5,
      defaultConfig: { theme: 'lobby-welcome', daysToShow: 7, showWeekend: false },
    },
    {
      name: 'Bottom Ticker',
      widgetType: 'TICKER',
      x: 0, y: 88, width: 100, height: 12,
      sortOrder: 6,
      defaultConfig: { theme: 'lobby-welcome', speed: 'medium', direction: 'left', messages: ['Welcome back, Sunshine Stars! ⭐', 'Picture day is this Friday!', 'Parent-teacher conferences next Tuesday'] },
    },
  ];

  for (const z of zones) {
    await prisma.templateZone.create({
      data: {
        templateId,
        name: z.name,
        widgetType: z.widgetType,
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
        sortOrder: z.sortOrder,
        defaultConfig: JSON.stringify(z.defaultConfig),
        zIndex: z.sortOrder
      }
    });
  }

  console.log('Lobby Welcome DB updated');
}

main().catch(console.error).finally(() => prisma.$disconnect());
