const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const librarySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="libraryWood" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2a1610" />
      <stop offset="50%" stop-color="#3d2116" />
      <stop offset="100%" stop-color="#1f100a" />
    </linearGradient>
    <pattern id="libraryLeather" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
      <rect width="100" height="100" fill="rgba(0,0,0,0.1)" />
      <circle cx="50" cy="50" r="1" fill="rgba(255,255,255,0.03)" />
      <path d="M 0 0 L 100 100 M 100 0 L 0 100" stroke="rgba(0,0,0,0.05)" stroke-width="2" />
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#libraryWood)" />
  <rect width="1920" height="1080" fill="url(#libraryLeather)" />
  
  <!-- Classic wall trim -->
  <rect x="0" y="800" width="1920" height="280" fill="#1c0f08" />
  <rect x="0" y="780" width="1920" height="20" fill="#4a2818" />
  
  <!-- Vertical wainscoting -->
  <g stroke="rgba(0,0,0,0.4)" stroke-width="8">
    <path d="M 240 800 V 1080 M 480 800 V 1080 M 720 800 V 1080 M 960 800 V 1080 M 1200 800 V 1080 M 1440 800 V 1080 M 1680 800 V 1080" />
  </g>
  <g stroke="rgba(255,255,255,0.05)" stroke-width="2">
    <path d="M 244 800 V 1080 M 484 800 V 1080 M 724 800 V 1080 M 964 800 V 1080 M 1204 800 V 1080 M 1444 800 V 1080 M 1684 800 V 1080" />
  </g>
</svg>`;

const athleticsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <radialGradient id="stadiumGlow" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#020617" />
    </radialGradient>
    <pattern id="jumbotronGrid" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#stadiumGlow)" />
  <rect width="1920" height="1080" fill="url(#jumbotronGrid)" />
  <!-- Stadium lights abstract -->
  <polygon points="0,0 400,0 150,150 0,100" fill="rgba(255,255,255,0.05)" />
  <polygon points="1920,0 1520,0 1770,150 1920,100" fill="rgba(255,255,255,0.05)" />
  <circle cx="100" cy="50" r="10" fill="#fff" filter="blur(5px)" />
  <circle cx="1820" cy="50" r="10" fill="#fff" filter="blur(5px)" />
</svg>`;

const middleSchoolSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="lockerBlue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <!-- Background wall -->
  <rect width="1920" height="1080" fill="#f8fafc" />
  
  <!-- Row of lockers -->
  <rect x="0" y="200" width="1920" height="880" fill="url(#lockerBlue)" />
  <g stroke="rgba(0,0,0,0.2)" stroke-width="4">
    <path d="M 320 200 V 1080 M 640 200 V 1080 M 960 200 V 1080 M 1280 200 V 1080 M 1600 200 V 1080" />
  </g>
  <!-- Locker vents & handles -->
  <g fill="rgba(0,0,0,0.1)">
    <!-- Locker 1 -->
    <rect x="250" y="600" width="20" height="100" rx="10" />
    <rect x="100" y="300" width="120" height="10" />
    <rect x="100" y="330" width="120" height="10" />
    <rect x="100" y="360" width="120" height="10" />
    <!-- Locker 2 -->
    <rect x="570" y="600" width="20" height="100" rx="10" />
    <rect x="420" y="300" width="120" height="10" />
    <rect x="420" y="330" width="120" height="10" />
    <rect x="420" y="360" width="120" height="10" />
    <!-- Locker 3 -->
    <rect x="890" y="600" width="20" height="100" rx="10" />
    <rect x="740" y="300" width="120" height="10" />
    <rect x="740" y="330" width="120" height="10" />
    <rect x="740" y="360" width="120" height="10" />
    <!-- Locker 4 -->
    <rect x="1210" y="600" width="20" height="100" rx="10" />
    <rect x="1060" y="300" width="120" height="10" />
    <rect x="1060" y="330" width="120" height="10" />
    <rect x="1060" y="360" width="120" height="10" />
    <!-- Locker 5 -->
    <rect x="1530" y="600" width="20" height="100" rx="10" />
    <rect x="1380" y="300" width="120" height="10" />
    <rect x="1380" y="330" width="120" height="10" />
    <rect x="1380" y="360" width="120" height="10" />
    <!-- Locker 6 -->
    <rect x="1850" y="600" width="20" height="100" rx="10" />
    <rect x="1700" y="300" width="120" height="10" />
    <rect x="1700" y="330" width="120" height="10" />
    <rect x="1700" y="360" width="120" height="10" />
  </g>
</svg>`;

const gymPeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="gymFloor" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e8b982" />
      <stop offset="100%" stop-color="#c18e53" />
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#gymFloor)" />
  <!-- Hardwood planks -->
  <g stroke="rgba(0,0,0,0.1)" stroke-width="2">
    <path d="M 0 100 H 1920 M 0 200 H 1920 M 0 300 H 1920 M 0 400 H 1920 M 0 500 H 1920 M 0 600 H 1920 M 0 700 H 1920 M 0 800 H 1920 M 0 900 H 1920 M 0 1000 H 1920" />
  </g>
  <!-- Court Lines -->
  <path d="M 960 0 V 1080" stroke="rgba(255,255,255,0.8)" stroke-width="20" />
  <circle cx="960" cy="540" r="300" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="20" />
  <circle cx="960" cy="540" r="10" fill="rgba(255,255,255,0.8)" />
  
  <path d="M -100 200 H 400 V 880 H -100" stroke="#dc2626" stroke-width="20" fill="none" />
  <path d="M 2020 200 H 1520 V 880 H 2020" stroke="#dc2626" stroke-width="20" fill="none" />
</svg>`;

const musicArtsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="velvetCurtain" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4a0404" />
      <stop offset="25%" stop-color="#7a0a0a" />
      <stop offset="50%" stop-color="#3d0303" />
      <stop offset="75%" stop-color="#8a1010" />
      <stop offset="100%" stop-color="#4a0404" />
    </linearGradient>
    <radialGradient id="spotlight" cx="50%" cy="0%" r="100%">
      <stop offset="0%" stop-color="rgba(255, 238, 173, 0.4)" />
      <stop offset="100%" stop-color="rgba(255, 238, 173, 0)" />
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#velvetCurtain)" />
  
  <!-- Curtain folds -->
  <g stroke="rgba(0,0,0,0.5)" stroke-width="20" opacity="0.5">
    <path d="M 200 0 V 1080 M 600 0 V 1080 M 1000 0 V 1080 M 1400 0 V 1080 M 1800 0 V 1080" />
  </g>
  <g stroke="rgba(255,255,255,0.1)" stroke-width="10">
    <path d="M 220 0 V 1080 M 620 0 V 1080 M 1020 0 V 1080 M 1420 0 V 1080 M 1820 0 V 1080" />
  </g>

  <!-- Stage floor -->
  <rect x="0" y="900" width="1920" height="180" fill="#1a1a1a" />
  
  <!-- Spotlight -->
  <rect width="1920" height="1080" fill="url(#spotlight)" />
</svg>`;

const stemScienceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="blueprintBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1b36" />
      <stop offset="100%" stop-color="#020813" />
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="none" stroke="rgba(56, 189, 248, 0.1)" stroke-width="1" />
    </pattern>
    <pattern id="gridLarge" width="200" height="200" patternUnits="userSpaceOnUse">
      <rect width="200" height="200" fill="none" stroke="rgba(56, 189, 248, 0.3)" stroke-width="2" />
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#blueprintBg)" />
  <rect width="1920" height="1080" fill="url(#grid)" />
  <rect width="1920" height="1080" fill="url(#gridLarge)" />
  
  <!-- Hexagon accents -->
  <g stroke="rgba(56, 189, 248, 0.4)" stroke-width="2" fill="none">
    <polygon points="100,50 150,25 200,50 200,100 150,125 100,100" />
    <polygon points="1720,850 1770,825 1820,850 1820,900 1770,925 1720,900" />
  </g>
</svg>`;

const busLoopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <pattern id="stripes" width="100" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="50" height="100" fill="#facc15" />
      <rect x="50" width="50" height="100" fill="#0f172a" />
    </pattern>
  </defs>
  <!-- Base background -->
  <rect width="1920" height="1080" fill="#0f172a" />
  
  <!-- Top and Bottom Warning Stripes -->
  <rect x="0" y="0" width="1920" height="40" fill="url(#stripes)" />
  <rect x="0" y="1040" width="1920" height="40" fill="url(#stripes)" />
</svg>`;

async function seedBackground(id, svgData) {
  const bgImage = 'data:image/svg+xml;base64,' + Buffer.from(svgData).toString('base64');
  await prisma.template.updateMany({
    where: { id },
    data: { bgImage, bgColor: null, bgGradient: null }
  });
  console.log('Updated background for', id);
}

async function main() {
  await seedBackground('library-quiet-zone', librarySvg);
  await seedBackground('high-school-athletics-scoreboard', athleticsSvg);
  await seedBackground('middle-school-hall-board', middleSchoolSvg);
  await seedBackground('gym-pe-display', gymPeSvg);
  await seedBackground('music-room-arts', musicArtsSvg);
  await seedBackground('stem-science-lab', stemScienceSvg);
  await seedBackground('bus-loop-dismissal-board', busLoopSvg);
  
  console.log('All 7 remaining backgrounds seeded successfully!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
