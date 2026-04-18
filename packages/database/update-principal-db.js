const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function main() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <!-- Rich Mahogany Wood Base -->
    <linearGradient id="woodBase" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e110a" />
      <stop offset="25%" stop-color="#3a2215" />
      <stop offset="50%" stop-color="#2a180f" />
      <stop offset="75%" stop-color="#422718" />
      <stop offset="100%" stop-color="#1e110a" />
    </linearGradient>

    <!-- Wood Grain Texture -->
    <filter id="woodGrain">
      <feTurbulence type="fractalNoise" baseFrequency="0.01 0.5" numOctaves="4" result="noise" />
      <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.15 0" in="noise" result="coloredNoise" />
      <feBlend in="SourceGraphic" in2="coloredNoise" mode="multiply" />
    </filter>

    <!-- Gold Foil Frame -->
    <linearGradient id="goldFrame" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE08B" />
      <stop offset="20%" stop-color="#D4AF37" />
      <stop offset="50%" stop-color="#FFFAEF" />
      <stop offset="80%" stop-color="#AA7C11" />
      <stop offset="100%" stop-color="#FDE08B" />
    </linearGradient>

    <!-- Subtle Vignette -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="50%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.7)" />
    </radialGradient>
  </defs>

  <!-- Base Wood Panel -->
  <rect width="1920" height="1080" fill="url(#woodBase)" />
  <rect width="1920" height="1080" fill="url(#woodBase)" filter="url(#woodGrain)" />

  <!-- Vertical Paneling Grooves -->
  <path d="M 320 0 V 1080 M 640 0 V 1080 M 960 0 V 1080 M 1280 0 V 1080 M 1600 0 V 1080" stroke="rgba(0,0,0,0.4)" stroke-width="6" />
  <path d="M 322 0 V 1080 M 642 0 V 1080 M 962 0 V 1080 M 1282 0 V 1080 M 1602 0 V 1080" stroke="rgba(255,255,255,0.03)" stroke-width="2" />

  <!-- Vignette -->
  <rect width="1920" height="1080" fill="url(#vignette)" />

  <!-- Outer Gold Frame Overlay -->
  <rect x="20" y="20" width="1880" height="1040" fill="none" stroke="url(#goldFrame)" stroke-width="4" rx="4" />
  <rect x="28" y="28" width="1864" height="1024" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="2" />
  <rect x="18" y="18" width="1884" height="1044" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="4" rx="6" />
</svg>`;
  const bgImage = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

  const templateId = 'principals-office-welcome';

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
      defaultConfig: { theme: 'principals-office', fitMode: 'contain' },
    },
    {
      name: 'Welcome Message',
      widgetType: 'TEXT',
      x: 25, y: 5, width: 50, height: 25,
      sortOrder: 1,
      defaultConfig: { theme: 'principals-office',
        content: 'Welcome — Please sign in at the front desk and have a seat. Someone will be with you shortly.',
        fontSize: 22,
        alignment: 'center',
        color: '#FFFFFF',
        bgColor: 'transparent',
      },
    },
    {
      name: 'Date & Time',
      widgetType: 'CLOCK',
      x: 77, y: 5, width: 20, height: 25,
      sortOrder: 2,
      defaultConfig: { theme: 'principals-office', format: '12h', showSeconds: false },
    },
    {
      name: 'Office Hours',
      widgetType: 'RICH_TEXT',
      x: 3, y: 33, width: 45, height: 50,
      sortOrder: 3,
      defaultConfig: { theme: 'principals-office',
        html: '<h3 style="color:#d97706; font-size:2rem; font-family:Georgia; margin-bottom:1rem;">Office Hours</h3><p style="color:#e2e8f0; font-size:1.5rem; margin-bottom:0.5rem;">Monday – Friday: 7:30 AM – 4:30 PM</p><p style="color:#e2e8f0; font-size:1.5rem; margin-bottom:0.5rem;">Principal available: 8:00 – 11:30 AM</p><p style="color:#e2e8f0; font-size:1.5rem;">Appointments preferred – call ext. 100</p><br><p style="color:#94a3b8; font-size:1.2rem; font-style:italic;">After-hours messages can be left with the main office.</p>',
      },
    },
    {
      name: 'Daily Announcement',
      widgetType: 'ANNOUNCEMENT',
      x: 50, y: 33, width: 47, height: 50,
      sortOrder: 4,
      defaultConfig: { theme: 'principals-office',
        title: 'NOTICE TO VISITORS',
        message: 'Thank you for visiting Washington High School. All visitors must check in at the front desk and wear a visitor badge while on campus.',
      },
    },
    {
      name: 'Bottom Ticker',
      widgetType: 'TICKER',
      x: 0, y: 88, width: 100, height: 12,
      sortOrder: 5,
      defaultConfig: { theme: 'principals-office',
        speed: 'slow',
        messages: ['Welcome to Washington High School', 'Excellence in Education', 'Please Silence Your Cell Phones']
      },
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

  console.log('Principal DB updated');
}

main().catch(console.error).finally(() => prisma.$disconnect());
