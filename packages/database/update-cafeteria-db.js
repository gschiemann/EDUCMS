const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bgImage = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZzEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjMkMzRTJEIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMxRTJCMUYiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGZpbHRlciBpZD0ibm9pc2UiPgoJCQk8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC42NSIgbnVtT2N0YXZlcz0iMyIgc3RpdGNoVGlsZXM9InN0aXRjaCIvPgoJCQk8ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMSAwIDAgMCAwLCAwIDEgMCAwIDAsIDAgMCAxIDAgMCwgMCAwIDAgMC4wOCAwIiAvPgoJCTwvZmlsdGVyPgogICAgPHBhdHRlcm4gaWQ9ImNoYWxrLWR1c3QiIHg9IjAiIHk9IjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPGNpcmNsZSBjeD0iMjUiIGN5PSI1MCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgLz4KICAgICAgPGNpcmNsZSBjeD0iMTMwIiBjeT0iODAiIHI9IjEuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgLz4KICAgICAgPGNpcmNsZSBjeD0iODAiIGN5PSIxNzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNCkiIC8+CiAgICAgIDxwYXRoIGQ9Ik00MCAxMzAgQzUwIDEyMCA2MCAxNDAgNzAgMTMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMikiIGZpbGw9Im5vbmUiIC8+CiAgICAgIDxwYXRoIGQ9Ik0xNTAgMzAgQzE2MCAyMCAxNzAgNDAgMTgwIDMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIGZpbGw9Im5vbmUiIC8+CiAgICA8L3BhdHRlcm4+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbGw9InVybCgjYmcxKSIgLz4KICA8cmVjdCB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxNDQwIiBmaWxsPSJ1cmwoI2NoYWxrLWR1c3QpIiAvPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbHRlcj0idXJsKCNub2lzZSkiIG9wYWNpdHk9IjAuNiIgLz4KPC9zdmc+";

  const templateId = 'cafeteria-daily-special';

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
      name: 'Menu Header',
      widgetType: 'TEXT',
      x: 2, y: 3, width: 66, height: 14,
      sortOrder: 0,
      defaultConfig: {
        theme: 'diner-chalkboard',
        content: "Today's Cafeteria Menu 🍽️",
        fontSize: 32,
        alignment: 'center',
        color: '#FECA57',
        bgColor: 'transparent',
      },
    },
    {
      name: 'Next Meal Countdown',
      widgetType: 'COUNTDOWN',
      x: 70, y: 3, width: 28, height: 14,
      sortOrder: 1,
      defaultConfig: {
        theme: 'diner-chalkboard',
        label: 'Next meal period',
        showHours: true,
        showDays: false,
      },
    },
    {
      name: 'Featured Menu Item',
      widgetType: 'LUNCH_MENU',
      x: 2, y: 20, width: 55, height: 75,
      sortOrder: 2,
      defaultConfig: {
        theme: 'diner-chalkboard',
        meals: [
          { label: "Today's Special", items: ['Crispy Chicken Sandwich'] },
          { label: 'Sides', items: ['Sweet Potato Fries', 'Steamed Broccoli', 'Fruit Cup'] },
          { label: 'Drinks', items: ['Chocolate Milk', 'Apple Juice', 'Water'] },
        ],
      },
    },
    {
      name: 'Food Photo',
      widgetType: 'IMAGE_CAROUSEL',
      x: 60, y: 20, width: 38, height: 45,
      sortOrder: 3,
      defaultConfig: {
        theme: 'diner-chalkboard',
        title: "Today's Feature",
        urls: [],
      },
    },
    {
      name: 'Chef Spotlight',
      widgetType: 'STAFF_SPOTLIGHT',
      x: 60, y: 68, width: 38, height: 27,
      sortOrder: 4,
      defaultConfig: {
        theme: 'diner-chalkboard',
        staffName: 'Chef Rodriguez',
        role: 'Head Chef',
        bio: 'Making lunches everyone loves!',
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

  console.log('Cafeteria DB updated');
}

main().catch(console.error).finally(() => prisma.$disconnect());
