/**
 * backfill-asset-hashes.ts — one-off MANUAL backfill of `Asset.fileHash`.
 *
 * WHY (audit 2026-05-30 §2 P2): new uploads populate `Asset.fileHash`
 * (SHA-256 hex of the bytes, `assets.controller.ts:556,947`), and the
 * service worker uses it to verify offline-cached media integrity
 * (`sw-player.js:475`). But assets uploaded BEFORE the hashing pipeline
 * landed have `fileHash = NULL`, so the SW skips integrity verification on
 * them — a tamper-detection gap on legacy media (incl. emergency assets).
 * This script closes it: for every null-hash Asset it downloads the bytes
 * from Supabase Storage, computes the SHA-256 the SAME way the upload path
 * does, and writes `fileHash` back.
 *
 * THIS IS NOT A CRON. Greg runs it by hand against prod (and against any
 * environment that pre-dates the hashing pipeline). It is:
 *   - idempotent — only touches rows where `fileHash IS NULL`; re-running
 *     after a partial pass picks up exactly what's left, and a fully-
 *     hashed DB is a no-op.
 *   - dry-run-able — `--dry-run` reports what WOULD change and writes
 *     nothing.
 *   - chatty — progress + a final summary so a long prod run is observable.
 *
 * USAGE (from repo root):
 *   # preview — writes nothing:
 *   pnpm db:backfill-hashes -- --dry-run
 *   # real run:
 *   pnpm db:backfill-hashes
 *   # tuning flags:
 *   pnpm db:backfill-hashes -- --batch=100 --limit=500 --tenant=<tenantId>
 *
 * (or directly, from packages/database with its tsx:)
 *   pnpm --filter @cms/database exec tsx ../../scripts/backfill-asset-hashes.ts --dry-run
 *
 * REQUIRES env (loaded from .env): DATABASE_URL, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. Same vars the API uses; never hardcode them.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const BUCKET = 'assets';

// ── flags ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (name: string) => argv.includes(`--${name}`);
const numFlag = (name: string, def: number): number => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const strFlag = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

const DRY_RUN = hasFlag('dry-run');
const BATCH = numFlag('batch', 50);
const LIMIT = numFlag('limit', Number.MAX_SAFE_INTEGER); // cap total rows processed
const TENANT = strFlag('tenant'); // optional: scope to one tenant

/**
 * Recover the bucket-relative storage path from a stored Supabase object URL
 * (public OR signed). Mirrors SupabaseStorageService.extractPath /
 * pathFromObjectUrl so this script hashes the exact same bytes the player
 * fetches. Returns null if the URL isn't a recognizable Supabase object URL
 * for OUR bucket (e.g. an external/CDN URL we don't own — skip it).
 */
function pathFromObjectUrl(objectUrl: string): string | null {
  if (typeof objectUrl !== 'string' || !objectUrl) return null;
  // Fast path: the public-URL shape the upload writes.
  const publicMarker = `/storage/v1/object/public/${BUCKET}/`;
  const pubIdx = objectUrl.indexOf(publicMarker);
  if (pubIdx !== -1) {
    const raw = objectUrl.slice(pubIdx + publicMarker.length).split('?')[0];
    return raw ? decodeURIComponent(raw) : null;
  }
  // General path: public | sign | authenticated.
  try {
    const u = new URL(objectUrl);
    const marker = `/storage/v1/object/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    let rest = u.pathname.slice(idx + marker.length);
    rest = rest.replace(/^(public|sign|authenticated)\//, '');
    const prefix = `${BUCKET}/`;
    if (!rest.startsWith(prefix)) return null;
    const path = rest.slice(prefix.length);
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

/** Download an object's bytes from Supabase storage. Mirrors
 *  SupabaseStorageService.download. Returns null on miss. */
async function download(
  filePath: string,
  url: string,
  key: string,
): Promise<Buffer | null> {
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (!res.ok) {
      console.warn(`    download failed (${res.status}) for ${filePath}`);
      return null;
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (err: any) {
    console.warn(`    download threw for ${filePath}: ${err?.message ?? err}`);
    return null;
  }
}

async function main() {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }
  if (!supaUrl || !supaKey) {
    console.error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot download bytes to hash. Aborting.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const where: any = { fileHash: null };
  if (TENANT) where.tenantId = TENANT;

  const total = await prisma.asset.count({ where });
  const toProcess = Math.min(total, LIMIT);

  console.log('─'.repeat(64));
  console.log(`Asset fileHash backfill ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE — will write)'}`);
  console.log(`  null-hash assets matching filter : ${total}`);
  console.log(`  will process this run            : ${toProcess}${TENANT ? ` (tenant=${TENANT})` : ''}`);
  console.log(`  batch size                       : ${BATCH}`);
  console.log('─'.repeat(64));

  if (toProcess === 0) {
    console.log('Nothing to do — every matching asset already has a fileHash. ✅');
    await prisma.$disconnect();
    return;
  }

  let scanned = 0;
  let hashed = 0;
  let skippedExternal = 0;
  let skippedMissing = 0;
  let failed = 0;

  // Page through null-hash rows. Because a LIVE run flips fileHash off-null,
  // those rows leave the result set on the next page — so we always read from
  // the current head with `take: BATCH` (no growing offset to drift). In a
  // DRY RUN nothing changes, so we advance a cursor by id instead.
  let cursorId: string | undefined;

  while (scanned < toProcess) {
    const take = Math.min(BATCH, toProcess - scanned);
    const page = await prisma.asset.findMany({
      where,
      select: { id: true, fileUrl: true, tenantId: true, originalName: true },
      orderBy: { id: 'asc' },
      take,
      ...(DRY_RUN && cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    if (page.length === 0) break;

    for (const asset of page) {
      scanned++;
      cursorId = asset.id;
      const label = asset.originalName ? `"${asset.originalName}"` : asset.id;

      const path = pathFromObjectUrl(asset.fileUrl);
      if (!path) {
        // External / non-Supabase URL (e.g. a pasted CDN image) — we don't
        // own those bytes, so there's nothing to verify against. Skip.
        skippedExternal++;
        console.log(`  [skip:external] ${label} — not an ${BUCKET}-bucket URL`);
        continue;
      }

      const buf = await download(path, supaUrl, supaKey);
      if (!buf) {
        skippedMissing++;
        console.log(`  [skip:missing ] ${label} — object not downloadable (${path})`);
        continue;
      }

      // EXACT same computation as the upload path
      // (assets.controller.ts: createHash('sha256').update(buf).digest('hex')).
      const fileHash = createHash('sha256').update(buf).digest('hex');

      if (DRY_RUN) {
        hashed++;
        console.log(`  [would-write ] ${label} → ${fileHash.slice(0, 12)}… (${buf.length} bytes)`);
        continue;
      }

      try {
        // Idempotency belt-and-braces: only set if still null, so a
        // concurrent run / re-run never overwrites an already-set hash.
        const r = await prisma.asset.updateMany({
          where: { id: asset.id, fileHash: null },
          data: { fileHash },
        });
        if (r.count > 0) {
          hashed++;
          console.log(`  [wrote       ] ${label} → ${fileHash.slice(0, 12)}… (${buf.length} bytes)`);
        } else {
          console.log(`  [already-set ] ${label} — hashed by another run, left as-is`);
        }
      } catch (e: any) {
        failed++;
        console.warn(`  [error       ] ${label} — write failed: ${e?.message ?? e}`);
      }
    }

    console.log(`  … progress: ${scanned}/${toProcess} scanned, ${hashed} hashed`);
  }

  console.log('─'.repeat(64));
  console.log('Done.');
  console.log(`  scanned          : ${scanned}`);
  console.log(`  ${DRY_RUN ? 'would hash' : 'hashed   '}        : ${hashed}`);
  console.log(`  skipped(external): ${skippedExternal}`);
  console.log(`  skipped(missing) : ${skippedMissing}`);
  console.log(`  failed           : ${failed}`);
  if (!DRY_RUN && (skippedMissing > 0 || failed > 0)) {
    console.log(
      '\n  Note: skipped/failed rows keep fileHash=null and remain safe to ' +
        're-run (idempotent). Investigate "missing" objects (deleted from ' +
        'storage but still referenced) separately.',
    );
  }
  console.log('─'.repeat(64));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
