import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const customs = await p.template.findMany({
    where: { isSystem: false, name: { contains: 'Back to School' } },
    orderBy: { updatedAt: 'desc' },
    take: 1,
  });
  const sys = await p.template.findFirst({ where: { isSystem: true, name: { contains: 'Back to School' } } });
  if (!customs[0] || !sys) return;
  const c = customs[0];
  console.log('Field-by-field diff:');
  const fields = ['name', 'description', 'category', 'orientation', 'screenWidth', 'screenHeight', 'bgColor', 'bgGradient', 'bgImage', 'status', 'isSystem'];
  for (const f of fields) {
    const cv = (c as any)[f];
    const sv = (sys as any)[f];
    const equal = (typeof cv === 'string' ? cv?.length : cv) === (typeof sv === 'string' ? sv?.length : sv);
    console.log(` ${f}: ${equal ? '=' : '≠'}  custom=${typeof cv === 'string' && cv && cv.length > 80 ? '['+cv.length+'b]' : JSON.stringify(cv)}  preset=${typeof sv === 'string' && sv && sv.length > 80 ? '['+sv.length+'b]' : JSON.stringify(sv)}`);
  }
  await p.$disconnect();
})();
