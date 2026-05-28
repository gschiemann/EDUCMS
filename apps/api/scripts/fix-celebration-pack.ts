/**
 * One-off fix (2026-05-28) — migrate any game still pinned to the OLD
 * v1 celebration pack onto v2 (the FINA water-polo canvas engine Greg
 * gave us in commit 87da542 — "the good animated ones").
 *
 * WHY THIS IS NEEDED (the honest version): commit be8aee7 flipped the
 * READ-SIDE DEFAULT from v1→v2 for games with NO explicit pack. But it
 * NEVER migrated existing games. Greg's live game
 * (0771435a Bruins vs Buckeyes) has `stats.celebrationPack = 'v1'` set
 * EXPLICITLY, so the default-flip does nothing for it — board + ribbon
 * both read `pack === 'v1' ? 'v1' : 'v2'`, and an explicit 'v1' wins.
 * Result: Greg told us the celebrations were swapped to "shit" and the
 * "fix" never changed what he actually sees.
 *
 * This sets every v1-pinned game to EXPLICIT 'v2'. Explicit (not just
 * deleting the key) because it's bulletproof against any read path that
 * might still default to v1 — every path checks `=== 'v1'` or
 * `=== 'v2'`, and 'v2' renders the v2 engine on all of them. Water polo
 * has full v2 art; other sports gracefully fall back to v1 art via
 * celebrationAsset() so this is a strict upgrade with zero downside.
 *
 * Writes an AuditLog row per change for the forensic trail.
 *
 * Run:  cd apps/api && ./node_modules/.bin/ts-node --transpile-only scripts/fix-celebration-pack.ts
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();
const SUPER_ADMIN_ID = '93f2fede-2bd1-43e7-a445-6b92f2ae7a72'; // greg.schiemann@e-arc.com

async function main() {
  const games = await prisma.game.findMany({
    where: {},
    select: { id: true, tenantId: true, homeTeam: true, awayTeam: true, stats: true },
  });

  const pinnedV1 = games.filter(
    (g) => (g.stats as Record<string, unknown> | null)?.celebrationPack === 'v1',
  );

  if (pinnedV1.length === 0) {
    console.log('No games pinned to v1. Nothing to migrate.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Migrating ${pinnedV1.length} game(s) from v1 → v2 celebration pack:\n`);

  for (const g of pinnedV1) {
    const nextStats = { ...(g.stats as Record<string, unknown>), celebrationPack: 'v2' };
    await prisma.game.update({ where: { id: g.id }, data: { stats: nextStats as any } });

    await prisma.auditLog.create({
      data: {
        tenantId: g.tenantId,
        userId: SUPER_ADMIN_ID,
        action: 'GAME_CELEBRATION_PACK_MIGRATED',
        targetType: 'GAME',
        targetId: g.id,
        details: JSON.stringify({
          from: 'v1',
          to: 'v2',
          reason:
            'be8aee7 flipped the read default but never migrated existing explicit-v1 games; this game still rendered v1.',
          home: g.homeTeam,
          away: g.awayTeam,
        }),
      },
    });

    console.log(`  ✓  ${g.id.slice(0, 8)}  ${g.homeTeam} vs ${g.awayTeam}  → v2`);
  }

  console.log(`\nDone. ${pinnedV1.length} game(s) now on v2.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
