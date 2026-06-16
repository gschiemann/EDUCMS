/**
 * Dodgers water-polo TEST roster seed (2026-06-16).
 * ─────────────────────────────────────────────────────────────────────────
 * Creates ONE clean water-polo game under the "Dodgers" tenant with a FULL
 * home + away roster (13 each), headshot photos, and realistic season stats,
 * so the operator can test rosters / lineup intros / scorer-attributed
 * celebrations end to end.
 *
 * Photos are placeholder headshots from pravatar.cc (we can't use real
 * players' photos) — swap them for real uploads from the roster screen later.
 *
 * Additive + idempotent: a FIXED game id is reused, and its roster is fully
 * replaced on each run. Nothing else in the tenant is touched.
 *
 *   node packages/database/prisma/seed-dodgers-waterpolo.mjs
 *   node packages/database/prisma/seed-dodgers-waterpolo.mjs --clean   (delete the game)
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();
const CLEAN = process.argv.includes('--clean');

const TENANT_ID = '28d09f9d-0a6c-4828-b46d-38712eb69f1f'; // Dodgers (SPORTS)
const GAME_ID = 'dodgers-wp-test-0001';                   // fixed → idempotent
const HOME = 'Dodgers';
const AWAY = 'Marina Vikings';
const HOME_COLOR = '#005A9C'; // dodger blue
const AWAY_COLOR = '#B3122B'; // vikings red

const pic = (n) => `https://i.pravatar.cc/320?img=${n}`;

// Water-polo roster: 1 GK + 12 field. Positions: GK, 2-Meter (hole set),
// 2-Meter D (hole defender), Wing, Driver, Point, Flat.
function roster(team, names, photoBase) {
  // names: [name, number, position, stats]
  return names.map(([name, number, position, stats], i) => ({
    tenantId: TENANT_ID,
    gameId: GAME_ID,
    team,
    name,
    number,
    position,
    photoUrl: pic(photoBase + i),
    stats,
    sortOrder: i,
  }));
}

// realistic-ish season lines
const gk = (saves, pct, ga) => ({ saves: String(saves), 'save%': pct, ga: String(ga) });
const fp = (g, a, s, d) => ({ goals: String(g), assists: String(a), steals: String(s), drawn: String(d) });

const HOME_ROSTER = roster('home', [
  ['Marcus Halvorsen', '1',  'Goalkeeper', gk(118, '.612', 71)],
  ['Diego Navarro',    '2',  'Driver',     fp(31, 22, 28, 19)],
  ['Luka Petrović',    '3',  '2-Meter',    fp(44, 9, 14, 41)],
  ['Cole Hammond',     '4',  'Wing',       fp(27, 18, 21, 16)],
  ['Andre Silva',      '5',  'Point',      fp(15, 26, 24, 12)],
  ['Tomas Reyes',      '6',  'Driver',     fp(29, 20, 25, 18)],
  ['Will Okafor',      '7',  '2-Meter D',  fp(8, 11, 33, 9)],
  ['Jack Mercer',      '8',  'Wing',       fp(22, 15, 19, 14)],
  ['Niko Antunović',   '9',  'Flat',       fp(19, 17, 16, 13)],
  ['Brady Quinn',      '10', 'Driver',     fp(24, 14, 22, 15)],
  ['Sergio Vega',      '11', '2-Meter',    fp(33, 7, 12, 28)],
  ['Owen Castellano',  '12', 'Point',      fp(11, 19, 20, 8)],
  ['Finn O’Hara', '1A', 'Goalkeeper', gk(41, '.588', 29)],
], 11);

const AWAY_ROSTER = roster('away', [
  ['Aleksandar Babić', '1',  'Goalkeeper', gk(126, '.634', 66)],
  ['Mateo Fuentes',    '2',  'Wing',       fp(26, 16, 18, 15)],
  ['Hugo Beaumont',    '3',  '2-Meter',    fp(39, 8, 13, 36)],
  ['Ryan Takahashi',   '4',  'Driver',     fp(33, 21, 27, 20)],
  ['Felix Moreau',     '5',  'Point',      fp(13, 28, 22, 10)],
  ['Stefan Kovač',     '6',  'Driver',     fp(30, 19, 24, 17)],
  ['Dario Esposito',   '7',  '2-Meter D',  fp(6, 9, 35, 7)],
  ['Liam Donovan',     '8',  'Wing',       fp(25, 13, 20, 16)],
  ['Pablo Iglesias',   '9',  'Flat',       fp(21, 15, 17, 12)],
  ['Theo Lindqvist',   '10', 'Driver',     fp(28, 12, 23, 14)],
  ['Marko Jurić',      '11', '2-Meter',    fp(36, 6, 11, 31)],
  ['Caleb Whitman',    '12', 'Point',      fp(10, 22, 19, 9)],
  ['Sven Eriksson',    '1A', 'Goalkeeper', gk(38, '.571', 31)],
], 33);

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) throw new Error(`Dodgers tenant ${TENANT_ID} not found`);

  if (CLEAN) {
    await prisma.rosterPlayer.deleteMany({ where: { gameId: GAME_ID } });
    await prisma.game.deleteMany({ where: { id: GAME_ID } });
    console.log('🧹 removed test game + roster');
    return;
  }

  // Upsert the game (fixed id → re-run safe). Pre-configure a 30s shot clock
  // (len) so the operator can immediately test starting it on this game.
  const stats = {
    homeShots: 0, awayShots: 0,
    homeExclusions: 0, awayExclusions: 0,
    homeTimeouts: 2, awayTimeouts: 2,
    shotClock: { len: 30, ms: 30000, at: new Date().toISOString(), running: false },
  };
  await prisma.game.upsert({
    where: { id: GAME_ID },
    update: {
      sport: 'water_polo', homeTeam: HOME, awayTeam: AWAY,
      homeColor: HOME_COLOR, awayColor: AWAY_COLOR, stats,
    },
    create: {
      id: GAME_ID, tenantId: TENANT_ID, sport: 'water_polo',
      homeTeam: HOME, awayTeam: AWAY, homeScore: 0, awayScore: 0,
      homeColor: HOME_COLOR, awayColor: AWAY_COLOR,
      segment: 1, status: 'SCHEDULED', stats,
    },
  });

  // Replace roster wholesale.
  await prisma.rosterPlayer.deleteMany({ where: { gameId: GAME_ID } });
  const all = [...HOME_ROSTER, ...AWAY_ROSTER];
  for (const p of all) {
    await prisma.rosterPlayer.create({ data: p });
  }

  const home = all.filter((p) => p.team === 'home').length;
  const away = all.filter((p) => p.team === 'away').length;
  console.log(`✅ Dodgers water-polo test game ${GAME_ID}`);
  console.log(`   ${HOME} (${home}) vs ${AWAY} (${away}) — ${all.length} players, photos + stats`);
  console.log(`   Open: /28d09f9d-0a6c-4828-b46d-38712eb69f1f/sports/${GAME_ID}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
