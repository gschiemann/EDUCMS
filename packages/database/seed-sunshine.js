const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Sunshine Academy template...');

  const preset = {
    id: 'preset-lobby-sunshine-academy',
    name: '🌞 Sunshine Academy — Elementary Welcome',
    description: 'A stunning, fully integrated elementary school welcome screen. Unlike regular templates, this renders as ONE cohesive design — the clock, weather, announcements, and teacher spotlight all blend seamlessly into a beautiful illustrated scene.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgImage: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNDQwIDgwMCIgcHJlc2VydmVBc3BlY3RSYXRpbz0ieE1pZFlNaWQgc2xpY2UiPgogIDxyZWN0IHdpZHRoPSIxNDQwIiBoZWlnaHQ9IjgwMCIgZmlsbD0iI0EwRDhFRiIgLz4KICA8Y2lyY2xlIGN4PSI3MjAiIGN5PSIyMDAiIHI9IjEwMCIgZmlsbD0idXJsKCNzdW5HcmFkKSIgZmlsdGVyPSJkcm9wLXNoYWRvdygwIDAgNDBweCByZ2JhKDI1NSwyMTUsMCwwLjYpKSIgLz4KICA8ZGVmcz4KICAgIDxyYWRpYWxHcmFkaWVudCBpZD0ic3VuR3JhZCIgY3g9IjUwJSIgY3k9IjUwJSIgcj0iNTAlIiBmeD0iNTAlIiBmeT0iNTAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI0ZGRDcwMCIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSI4MCUiIHN0b3AtY29sb3I9IiNGRkE1MDAiIC8+CiAgICA8L3JhZGlhbEdyYWRpZW50PgogIDwvZGVmcz4KICA8cGF0aCBmaWxsPSIjNkRCMjcyIiBkPSJNMCw1MDBMNDgsNTA1LjNDOTYsNTExLDE5Miw1MjEsMjg4LDUzNy4zQzM4NCw1NTMsNDgwLDU3NSw1NzYsNTU4LjdDNjcyLDU0Myw3NjgsNDg5LDg2NCw0ODkuM0M5NjAsNDg5LDEwNTYsNTQzLDExNTIsNTQyLjdDMTI0OCw1NDMsMTM0NCw0ODksMTM5Miw0NjIuN0wxNDQwLDQzNkwxNDQwLDgwMEwxMzkyLDgwMEMxMzQ0LDgwMCwxMjQ4LDgwMCwxMTUyLDgwMEMxMDU2LDgwMCw5NjAsODAwLDg2NCw4MDBDNzY4LDgwMCw2NzIsODAwLDU3Niw4MDBDNDgwLDgwMCwzODQsODAwLDI4OCw4MDBDMTkyLDgwMCw5Niw4MDAsNDgsODAwTDAsODAwWiI+PC9wYXRoPgogIDxwYXRoIGZpbGw9IiM1NDk5NTkiIGQ9Ik0wLDYwMEw2MCw1ODkuM0MxMjAsNTc5LDI0MCw1NTcsMzYwLDU1Ny4zQzQ4MCw1NTcsNjAwLDU3OSw3MjAsNTk0LjdDODQwLDYxMSw5NjAsNjIxLDEwODAsNjEwLjdDMTIwMCw2MDAsMTMyMCw1NjgsMTM4MCw1NTJMMTQ0MCw1MzZMMTQ0MCw4MDBMMTM4MCw4MDBDMTMyMCw4MDAsMTIwMCw4MDAsMTA4MCw4MDBDOTYwLDgwMCw4NDAsODAwLDcyMCw4MDBDNjAwLDgwMCw0ODAsODAwLDM2MCw4MDBDMjQwLDgwMCwxMjAsODAwLDYwLDgwMEwwLDgwMFoiPjwvcGF0aD4KICA8cGF0aCBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjgiIGQ9Ik0yMDAsMTUwIFEyMzAsMTMwIDI1MCwxNTAgUTI4MCwxNDAgMjkwLDE3MCBRMzEwLDE4MCAyOTAsMjAwIFEyNzAsMjIwIDIzMCwyMTAgUTIwMCwyMjAgMTgwLDIwMCBRMTYwLDE4MCAxODAsMTYwIFExNzAsMTQwIDIwMCwxNTBaIiAvPgogIDxwYXRoIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuNiIgZD0iTTExMDAsMjUwIFExMTMwLDIzMCAxMTUwLDI1MCBRMTE4MCwyNDAgMTE5MCwyNzAgUTEyMTAsMjgwIDExOTAsMzAwIFExMTcwLDMyMCAxMTMwLDMxMCBRMTEwMCwzMjAgMTA4MCwzMDAgUTEwNjAsMjgwIDEwODAsMjYwIFExMDcwLDI0MCAxMTAwLDI1MFoiIC8+Cjwvc3ZnPgo=",

    isSystem: true,
    status: 'PUBLISHED',
    zones: {
      create: [
        { name: 'Welcome Headline', widgetType: 'TEXT', x: 0, y: 0, width: 100, height: 16, sortOrder: 0,
          defaultConfig: JSON.stringify({ content: 'Welcome to Sunshine Academy! ☀️', theme: 'sunshine-academy' }) },
        { name: 'Clock', widgetType: 'CLOCK', x: 75, y: 2, width: 22, height: 14, sortOrder: 1,
          defaultConfig: JSON.stringify({ format: '12h', theme: 'sunshine-academy' }) },
        { name: 'Weather', widgetType: 'WEATHER', x: 3, y: 18, width: 26, height: 16, sortOrder: 2,
          defaultConfig: JSON.stringify({ location: 'Springfield', units: 'imperial', theme: 'sunshine-academy' }) },
        { name: 'Announcement', widgetType: 'ANNOUNCEMENT', x: 30, y: 18, width: 40, height: 36, sortOrder: 3,
          defaultConfig: JSON.stringify({ title: 'Book Fair starts Monday!', message: 'Come explore hundreds of new books in the library. Bring your reading log!', badgeLabel: "📣 Today's Announcement", theme: 'sunshine-academy' }) },
        { name: 'Teacher of the Week', widgetType: 'STAFF_SPOTLIGHT', x: 3, y: 38, width: 25, height: 32, sortOrder: 4,
          defaultConfig: JSON.stringify({ staffName: 'Mrs. Johnson', role: 'Teacher of the Week', bio: 'Inspiring 3rd graders every day with creativity and kindness!', theme: 'sunshine-academy' }) },
        { name: 'Countdown', widgetType: 'COUNTDOWN', x: 75, y: 18, width: 22, height: 20, sortOrder: 5,
          defaultConfig: JSON.stringify({ label: 'Field Trip In', targetDate: '', theme: 'sunshine-academy' }) },
        { name: 'Events', widgetType: 'CALENDAR', x: 75, y: 42, width: 22, height: 28, sortOrder: 6,
          defaultConfig: JSON.stringify({ maxEvents: 4, theme: 'sunshine-academy' }) },
        { name: 'Photos', widgetType: 'IMAGE_CAROUSEL', x: 30, y: 56, width: 40, height: 18, sortOrder: 7,
          defaultConfig: JSON.stringify({ transitionEffect: 'fade', intervalMs: 5000, theme: 'sunshine-academy' }) },
        { name: 'Ticker', widgetType: 'TICKER', x: 0, y: 94, width: 100, height: 6, sortOrder: 8,
          defaultConfig: JSON.stringify({ speed: 'medium', messages: ['Welcome back, Sunshine Stars! ⭐', 'Picture day is this Friday!', 'Parent-teacher conferences next Tuesday'], theme: 'sunshine-academy' }) },
      ]
    }
  };

  // Delete if exists
  const existing = await prisma.template.findUnique({ where: { id: preset.id } });
  if (existing) {
    await prisma.templateZone.deleteMany({ where: { templateId: preset.id } });
    await prisma.template.delete({ where: { id: preset.id } });
  }

  await prisma.template.create({ data: preset });
  console.log('✅ Sunshine Academy seeded!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
