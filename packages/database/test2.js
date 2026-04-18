const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const t1 = await prisma.template.findFirst({ where: { name: 'STEM & Science Lab', isSystem: true } });
  const t2 = await prisma.template.findFirst({ where: { name: 'Cafeteria Menu Board', isSystem: true } });

  const html = `
    <html>
    <body>
      <h2>STEM Gradient</h2>
      <div style="width:800px;height:450px;background:${t1.bgGradient};">TEST</div>
      <h2>STEM Image</h2>
      <div style="width:800px;height:450px;background-image:url(${t1.bgImage});background-size:cover;">TEST</div>
      <h2>Cafeteria Gradient</h2>
      <div style="width:800px;height:450px;background:${t2.bgGradient};">TEST</div>
    </body>
    </html>
  `;
  fs.writeFileSync('test2.html', html);
  console.log('wrote test2.html');
}

main().finally(() => prisma.$disconnect());
