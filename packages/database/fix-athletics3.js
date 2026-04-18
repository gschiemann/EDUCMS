const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ATHLETICS_BG = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1080 1920' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <!-- Background Gradient -->
    <radialGradient id='bgGrad' cx='50%' cy='50%' r='70%'>
      <stop offset='0%' stop-color='%231E293B'/>
      <stop offset='100%' stop-color='%23020617'/>
    </radialGradient>
    
    <!-- Perforated Metal Pattern -->
    <pattern id='mesh' width='24' height='24' patternUnits='userSpaceOnUse'>
      <circle cx='12' cy='12' r='4' fill='%23000000' opacity='0.8'/>
      <circle cx='12' cy='13' r='4' fill='%23ffffff' opacity='0.05'/>
    </pattern>

    <!-- Metal Frame Gradient -->
    <linearGradient id='metalFrame' x1='0' y1='0' x2='1' y2='0'>
      <stop offset='0%' stop-color='%23111827'/>
      <stop offset='10%' stop-color='%23334155'/>
      <stop offset='50%' stop-color='%231E293B'/>
      <stop offset='90%' stop-color='%23334155'/>
      <stop offset='100%' stop-color='%230F172A'/>
    </linearGradient>

    <!-- Neon Glow -->
    <filter id='neonGlow'>
      <feGaussianBlur stdDeviation='10' result='coloredBlur'/>
      <feMerge>
        <feMergeNode in='coloredBlur'/>
        <feMergeNode in='SourceGraphic'/>
      </feMerge>
    </filter>
  </defs>

  <!-- Deep mesh background -->
  <rect width='1080' height='1920' fill='url(%23bgGrad)'/>
  <rect width='1080' height='1920' fill='url(%23mesh)'/>

  <!-- Top metal beam -->
  <rect x='0' y='0' width='1080' height='120' fill='url(%23metalFrame)'/>
  <rect x='0' y='120' width='1080' height='4' fill='%23000000' opacity='0.5'/>
  
  <!-- Bottom metal beam -->
  <rect x='0' y='1800' width='1080' height='120' fill='url(%23metalFrame)'/>
  <rect x='0' y='1796' width='1080' height='4' fill='%23000000' opacity='0.5'/>
  
  <!-- Left metal beam -->
  <rect x='0' y='0' width='60' height='1920' fill='url(%23metalFrame)'/>
  <rect x='60' y='0' width='4' height='1920' fill='%23000000' opacity='0.5'/>
  
  <!-- Right metal beam -->
  <rect x='1020' y='0' width='60' height='1920' fill='url(%23metalFrame)'/>
  <rect x='1016' y='0' width='4' height='1920' fill='%23000000' opacity='0.5'/>

  <!-- Glowing Neon Borders inside the frame -->
  <rect x='64' y='124' width='952' height='1672' fill='none' stroke='%23EF4444' stroke-width='6' opacity='0.9' filter='url(%23neonGlow)'/>
  <rect x='74' y='134' width='932' height='1652' fill='none' stroke='%233B82F6' stroke-width='2' opacity='0.6'/>

  <!-- Stadium Spotlights Top -->
  <polygon points='100,120 400,1920 0,1920' fill='%23ffffff' opacity='0.03' style='mix-blend-mode: overlay;'/>
  <polygon points='980,120 680,1920 1080,1920' fill='%23ffffff' opacity='0.03' style='mix-blend-mode: overlay;'/>

  <!-- Screw Details -->
  <circle cx='30' cy='60' r='10' fill='%230f172a' stroke='%23475569' stroke-width='2'/>
  <circle cx='1050' cy='60' r='10' fill='%230f172a' stroke='%23475569' stroke-width='2'/>
  <circle cx='30' cy='1860' r='10' fill='%230f172a' stroke='%23475569' stroke-width='2'/>
  <circle cx='1050' cy='1860' r='10' fill='%230f172a' stroke='%23475569' stroke-width='2'/>
</svg>`;
  const encoded = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').replace(/"/g, "'");
  return `url("data:image/svg+xml;utf8,${encoded}") center/cover, #0F172A`;
})();

async function main() {
  const templates = await prisma.template.findMany({
    where: { name: { contains: "🏆 High School Athletics Jumbotron" } }
  });

  console.log(`Found ${templates.length} templates.`);

  for (const t of templates) {
    console.log(`Upgrading ${t.name}...`);
    await prisma.template.update({
      where: { id: t.id },
      data: { bgGradient: ATHLETICS_BG }
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
