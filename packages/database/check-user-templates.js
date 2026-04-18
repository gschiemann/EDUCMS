const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.template.findMany({ where: { isSystem: false }, include: { zones: true } });
  console.log("Custom templates:", c.length);
  c.forEach(t => {
    console.log(t.name);
    t.zones.forEach(z => {
      console.log('  ', z.name, z.defaultConfig ? JSON.parse(z.defaultConfig).theme : 'no theme');
    });
  });
}
main();
