const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();
async function main() {
  const t = await prisma.template.findFirst({ where: { name: 'Cafeteria Menu Board', isSystem: true } });
  fs.writeFileSync('test.html', '<div style="width:800px;height:450px;background:' + t.bgGradient + ';">TEST</div>');
  console.log('wrote test.html');
}
main().finally(() => prisma.$disconnect());
