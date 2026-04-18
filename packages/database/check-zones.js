const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { template: { name: '🏆 High School Athletics Jumbotron', isSystem: true } } 
}).then(zones => console.log(zones)).finally(() => prisma.$disconnect());
