/* One-off: set celebrationPack='v2' on every Dodgers water-polo game so the
 * cinematic cues load NOW (water polo otherwise defaults to v1/deck). Merges
 * into existing stats — preserves scores, clock, shot clock, exclusions. */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') });
const prisma = new PrismaClient();
const TENANT = '28d09f9d-0a6c-4828-b46d-38712eb69f1f';

async function main() {
  const games = await prisma.game.findMany({
    where: { tenantId: TENANT, sport: 'water_polo' },
    select: { id: true, homeTeam: true, awayTeam: true, stats: true },
  });
  for (const g of games) {
    const stats = (g.stats && typeof g.stats === 'object') ? { ...g.stats } : {};
    stats.celebrationPack = 'v2';
    await prisma.game.update({ where: { id: g.id }, data: { stats } });
    console.log(`✅ ${g.id}  ${g.homeTeam} vs ${g.awayTeam}  → celebrationPack=v2`);
  }
  console.log(`Updated ${games.length} water-polo game(s).`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
