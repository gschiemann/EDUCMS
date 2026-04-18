const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const bgImage = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjEwODAiIHZpZXdCb3g9IjAgMCAxOTIwIDEwODAiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZzEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjMkMzRTJEIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMxRTJCMUYiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGZpbHRlciBpZD0ibm9pc2UiPgoJCQk8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC42NSIgbnVtT2N0YXZlcz0iMyIgc3RpdGNoVGlsZXM9InN0aXRjaCIvPgoJCQk8ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMSAwIDAgMCAwLCAwIDEgMCAwIDAsIDAgMCAxIDAgMCwgMCAwIDAgMC4wOCAwIiAvPgoJCTwvZmlsdGVyPgogICAgPHBhdHRlcm4gaWQ9ImNoYWxrLWR1c3QiIHg9IjAiIHk9IjAiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPGNpcmNsZSBjeD0iMjUiIGN5PSI1MCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA1KSIgLz4KICAgICAgPGNpcmNsZSBjeD0iMTMwIiBjeT0iODAiIHI9IjEuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgLz4KICAgICAgPGNpcmNsZSBjeD0iODAiIGN5PSIxNzAiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNCkiIC8+CiAgICAgIDxwYXRoIGQ9Ik00MCAxMzAgQzUwIDEyMCA2MCAxNDAgNzAgMTMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMikiIGZpbGw9Im5vbmUiIC8+CiAgICAgIDxwYXRoIGQ9Ik0xNTAgMzAgQzE2MCAyMCAxNzAgNDAgMTgwIDMwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIGZpbGw9Im5vbmUiIC8+CiAgICA8L3BhdHRlcm4+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbGw9InVybCgjYmcxKSIgLz4KICA8cmVjdCB3aWR0aD0iMTkyMCIgaGVpZ2h0PSIxNDQwIiBmaWxsPSJ1cmwoI2NoYWxrLWR1c3QpIiAvPgogIDxyZWN0IHdpZHRoPSIxOTIwIiBoZWlnaHQ9IjE0NDAiIGZpbHRlcj0idXJsKCNub2lzZSkiIG9wYWNpdHk9IjAuNiIgLz4KPC9zdmc+";

async function main() {
  const templates = await prisma.template.findMany({
    where: {
      OR: [
        { name: { contains: 'Cafeteria Menu Board' } },
        { name: { contains: 'Cafeteria Chalkboard' } },
        { name: { contains: 'Cafeteria Daily Special' } },
        { name: { contains: 'Cafeteria (Working Copy)' } }
      ]
    }
  });

  let updated = 0;
  for (const t of templates) {
    await prisma.template.update({
      where: { id: t.id },
      data: {
        bgImage: bgImage,
        bgGradient: null,
      }
    });
    console.log('Fixed Cafeteria background for: ' + t.name);
    updated++;
  }
  
  console.log('Updated ' + updated + ' templates.');
}

main().finally(() => prisma.$disconnect());
