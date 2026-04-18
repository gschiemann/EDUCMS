const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(34, 197, 94, 0.05)" stroke-width="1"/>
    </pattern>
    <pattern id="diagonal" width="20" height="20" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="20" stroke="rgba(34, 197, 94, 0.1)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect width="1920" height="1080" fill="url(#grid)"/>
  <circle cx="1500" cy="-200" r="800" fill="none" stroke="rgba(59, 130, 246, 0.05)" stroke-width="100"/>
  <circle cx="1500" cy="-200" r="600" fill="none" stroke="rgba(59, 130, 246, 0.05)" stroke-width="60"/>
  <polygon points="0,1080 1920,800 1920,1080" fill="url(#diagonal)"/>
</svg>`;

const b64 = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

async function main() {
  await prisma.template.update({
    where: { id: 'gym-pe-display' },
    data: { bgImage: b64, bgGradient: '' }
  });
  console.log('Updated gym background');
}

main().catch(console.error).finally(() => prisma.$disconnect());
