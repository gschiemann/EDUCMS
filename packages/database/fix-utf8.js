const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.template.findMany({
    select: { id: true, bgImage: true, bgGradient: true, name: true }
  });

  let updated = 0;

  for (const t of templates) {
    let changed = false;
    let newBgImage = t.bgImage;
    let newBgGradient = t.bgGradient;

    const fixUtf8DataUri = (str) => {
      if (!str || !str.includes('data:image/svg+xml;utf8,')) return str;

      // Split the string at the data URI
      const parts = str.split('data:image/svg+xml;utf8,');
      if (parts.length !== 2) return str;
      
      // The second part has the SVG, then a closing quote or parenthesis, then the rest of the CSS
      // Example: <svg ...></svg>") center/cover
      
      let svgContent = '';
      let rest = '';
      
      if (parts[1].includes('")')) {
        const subParts = parts[1].split('")');
        svgContent = subParts[0];
        rest = '")' + subParts.slice(1).join('")');
      } else if (parts[1].includes("')")) {
        const subParts = parts[1].split("')");
        svgContent = subParts[0];
        rest = "')" + subParts.slice(1).join("')");
      } else {
        return str; // couldn't parse
      }

      let decoded = svgContent;
      try { decoded = decodeURIComponent(svgContent.replace(/%23/g, '#')); } catch(e) {}
      
      const base64 = Buffer.from(decoded, 'utf8').toString('base64');
      return parts[0] + 'data:image/svg+xml;base64,' + base64 + rest;
    };

    if (newBgImage) {
      const fixed = fixUtf8DataUri(newBgImage);
      if (fixed !== newBgImage) { newBgImage = fixed; changed = true; }
    }

    if (newBgGradient) {
      const fixed = fixUtf8DataUri(newBgGradient);
      if (fixed !== newBgGradient) { newBgGradient = fixed; changed = true; }
    }

    if (changed) {
      await prisma.template.update({
        where: { id: t.id },
        data: { bgImage: newBgImage, bgGradient: newBgGradient }
      });
      console.log(`Fixed utf8 data URI for: ${t.name}`);
      updated++;
    }
  }
  
  console.log(`Updated ${updated} templates.`);
}

main().finally(() => prisma.$disconnect());
