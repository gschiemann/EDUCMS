import { createHash } from 'crypto';
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// Assets hashed per boot. The fileHash:null set shrinks each run, so the
// back-catalogue heals over a few boots without a big one-shot egress spike.
const BATCH = 100;

/**
 * Backfill `Asset.fileHash` for MANAGED (our Supabase) assets that have none.
 *
 * Audit 2026-06-06 (#6 — emergency-media integrity). The emergency manifest
 * ships `sha256: asset.fileHash ?? null`, and the player service worker SKIPS
 * body-hash verification when the hash is null (sw-player.js) — so legacy /
 * pre-hashing media is cached on trust, with no integrity check. New uploads
 * are hashed at upload time (assets.controller); this heals the back catalogue
 * so offline + life-safety media becomes integrity-verified too.
 *
 * Scope + safety (deliberately conservative — this is emergency-adjacent):
 *  - ONLY assets whose `fileUrl` is under our own `SUPABASE_URL`. Arbitrary
 *    external URLs are never fetched here (SSRF surface + we can't vouch for
 *    their bytes). Per-screen emergency URLs stored as raw strings (not Asset
 *    rows) are out of scope — they need a separate pass.
 *  - Capped at BATCH per boot, idempotent (only `fileHash: null` rows), and
 *    fully best-effort: any failure is swallowed and retried next boot. It
 *    NEVER blocks boot, and it only WRITES a hash — it cannot weaken or alter
 *    any emergency trigger / manifest / playback path.
 *  - The SW recomputes the SAME SHA-256 from the SAME object bytes, so a hash
 *    stored here matches on the device (no false "tampered" rejections).
 *  - Kill switch: set `EMERGENCY_HASH_BACKFILL=off` to disable entirely.
 */
export async function backfillManagedAssetHashes(
  prisma: PrismaService,
  logger: Logger,
): Promise<void> {
  if ((process.env.EMERGENCY_HASH_BACKFILL || '').toLowerCase() === 'off') return;

  const supabaseOrigin = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!supabaseOrigin) return; // can't identify managed assets without the bucket origin

  const rows = await prisma.client.asset.findMany({
    where: { fileHash: null, fileUrl: { startsWith: supabaseOrigin } },
    select: { id: true, fileUrl: true },
    take: BATCH,
  });
  if (rows.length === 0) return;

  let hashed = 0;
  for (const a of rows) {
    try {
      const res = await fetch(a.fileUrl, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) continue;
      const fileHash = createHash('sha256').update(buf).digest('hex');
      // ten-ok: platform-wide boot maintenance job — deliberately cross-tenant and
      // therefore has no tenant to scope by. It writes ONE derived column (fileHash) on
      // rows it selected itself by `fileHash: null`, never on an id from a request.
      await prisma.client.asset.update({ where: { id: a.id }, data: { fileHash } });
      hashed += 1;
    } catch {
      // best-effort — leave fileHash null and try again on the next boot
    }
  }

  logger.log(
    `Asset hash backfill: hashed ${hashed}/${rows.length} managed assets ` +
      `(offline + emergency-media integrity)`,
  );
}
