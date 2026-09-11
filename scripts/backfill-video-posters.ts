/**
 * backfill-video-posters.ts — one-off MANUAL backfill of `Asset.posterUrl`.
 *
 * WHY: the asset picker draws a video tile as `<video preload="none">`, which
 * paints a blank grey rectangle — the operator saw 11 real videos identifiable
 * only by a truncated filename ("every sample content is blank"). New uploads
 * now get a poster frame automatically (VideoPosterService, fire-and-forget on
 * both upload paths). Every video uploaded BEFORE that has `posterUrl = NULL`
 * and still shows as a grey box. This script closes the gap: for each such
 * video it extracts one frame with ffmpeg, stores it next to the video in the
 * public `assets` bucket, and writes the URL back.
 *
 * THIS IS NOT A CRON, and it is DRY-RUN BY DEFAULT. It is:
 *   - dry-run unless you pass --apply — a bare run downloads nothing, writes
 *     nothing, and just reports what it would do;
 *   - idempotent — the candidate filter is `posterUrl IS NULL`, and the write
 *     re-asserts that condition, so a re-run (or two runs at once) can never
 *     overwrite a poster that already exists;
 *   - resumable — every line of the summary ends with a `--after=<id>` you can
 *     hand back to continue exactly where it stopped;
 *   - rate-limited — a pause between rows (default 400 ms) so a large backfill
 *     can't saturate Supabase egress or the connection pool.
 *
 * USAGE (from repo root):
 *   # preview — the default; writes nothing, downloads nothing:
 *   pnpm db:backfill-posters
 *   # real run:
 *   pnpm db:backfill-posters -- --apply
 *   # tuning:
 *   pnpm db:backfill-posters -- --apply --batch=25 --limit=100 \
 *                               --tenant=<tenantId> --delay=400 --after=<assetId>
 *
 * (or directly, from packages/database with its tsx:)
 *   pnpm --filter @cms/database exec tsx ../../scripts/backfill-video-posters.ts
 *
 * REQUIRES: `ffmpeg` on PATH (the production image has it; on a Mac,
 * `brew install ffmpeg`) and env DATABASE_URL, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY — the same vars the API uses. Never hardcode them.
 *
 * ⚠️ Point it at the database in your env and nothing else. There is no
 * `--force`/`--prod` affordance on purpose: the safety here is that the
 * default run cannot change anything.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import {
  runPosterBackfill,
  type BackfillAssetRow,
  type MakePosterResult,
} from '../apps/api/src/storage/video-poster-backfill';
import {
  extractVideoPosterFromBuffer,
  extractVideoPosterFromUrl,
  POSTER_EXT,
  POSTER_MIME,
} from '../apps/api/src/storage/video-poster';

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

// DRY RUN IS THE DEFAULT. --apply is the only way to write.
const APPLY = hasFlag('apply');
const BATCH = numFlag('batch', 25);
const LIMIT = numFlag('limit', Number.MAX_SAFE_INTEGER);
const DELAY_MS = numFlag('delay', 400);
const TENANT = strFlag('tenant');
const AFTER = strFlag('after');

/**
 * Recover the bucket-relative path from a stored Supabase object URL.
 * Mirrors SupabaseStorageService.parseObjectUrl. Returns null for anything
 * that isn't an object in OUR bucket — an external/CDN URL added via
 * `POST /assets/url` has bytes we don't own, and we never hand a stored
 * third-party URL to ffmpeg.
 */
function pathFromObjectUrl(objectUrl: string): string | null {
  if (typeof objectUrl !== 'string' || !objectUrl) return null;
  const publicMarker = `/storage/v1/object/public/${BUCKET}/`;
  const pubIdx = objectUrl.indexOf(publicMarker);
  if (pubIdx !== -1) {
    const raw = objectUrl.slice(pubIdx + publicMarker.length).split('?')[0];
    return raw ? decodeURIComponent(raw) : null;
  }
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

/** Mirrors SupabaseStorageService.download. */
async function download(filePath: string, url: string, key: string): Promise<Buffer | null> {
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Mirrors SupabaseStorageService.uploadToBucket for the public `assets`
 * bucket — same REST endpoint, same immutable cache-control (posters are
 * content-addressed by uuid and never mutated in place), same x-upsert.
 */
async function uploadPoster(
  filePath: string,
  buffer: Buffer,
  url: string,
  key: string,
): Promise<string> {
  const endpoint = `${url}/storage/v1/object/${BUCKET}/${filePath}`;
  const ab = new ArrayBuffer(buffer.length);
  new Uint8Array(ab).set(buffer);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': POSTER_MIME,
      'Content-Length': String(buffer.length),
      'x-upsert': 'true',
      'cache-control': 'max-age=31536000',
    },
    body: new Blob([ab]),
  });
  if (!res.ok) throw new Error(`poster upload failed (${res.status}): ${await res.text()}`);
  return `${url}/storage/v1/object/public/${BUCKET}/${filePath}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const supaUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supaKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }
  // A DRY RUN needs the DB only; a LIVE run needs storage credentials too.
  if (APPLY && (!supaUrl || !supaKey)) {
    console.error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot read video bytes or store posters. Aborting.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const where: any = { posterUrl: null, mimeType: { startsWith: 'video/' } };
  if (TENANT) where.tenantId = TENANT;

  const trustedPrefix = `${supaUrl}/storage/v1/object/public/${BUCKET}/`;

  const summary = await runPosterBackfill(
    {
      countCandidates: () => prisma.asset.count({ where }),
      fetchBatch: (afterId, take) =>
        prisma.asset.findMany({
          where: afterId ? { ...where, id: { gt: afterId } } : where,
          select: { id: true, tenantId: true, fileUrl: true, mimeType: true, originalName: true },
          orderBy: { id: 'asc' },
          take,
        }) as Promise<BackfillAssetRow[]>,
      storagePathFor: (row) => pathFromObjectUrl(row.fileUrl),
      makePoster: async (row, storagePath): Promise<MakePosterResult> => {
        try {
          // Cheap path first: an INPUT seek over https range-reads to the
          // first keyframe instead of pulling the whole video back.
          const url = `${trustedPrefix}${storagePath}`;
          let out = await extractVideoPosterFromUrl(url, trustedPrefix);
          if (!out.ok) {
            const bytes = await download(storagePath, supaUrl, supaKey);
            if (!bytes) return { ok: false, reason: `url:${out.reason}; download-miss` };
            out = await extractVideoPosterFromBuffer(bytes, extOf(storagePath));
          }
          if (!out.ok) return { ok: false, reason: out.reason };
          const posterPath = `${row.tenantId}/posters/${randomUUID()}${POSTER_EXT}`;
          const posterUrl = await uploadPoster(posterPath, out.buffer, supaUrl, supaKey);
          return { ok: true, posterUrl, bytes: out.bytes };
        } catch (e: any) {
          return { ok: false, reason: `threw: ${e?.message ?? e}` };
        }
      },
      // Tenant-scoped AND still-null-guarded: this is the idempotency lock.
      persist: async (row, posterUrl) => {
        const r = await prisma.asset.updateMany({
          where: { id: row.id, tenantId: row.tenantId, posterUrl: null },
          data: { posterUrl },
        });
        return r.count;
      },
      log: (line) => console.log(line),
      sleep,
    },
    { dryRun: !APPLY, batch: BATCH, limit: LIMIT, delayMs: DELAY_MS, afterId: AFTER },
  );

  if (!APPLY && summary.posted > 0) {
    console.log('\n  This was a DRY RUN. Re-run with --apply to write posters.');
  }

  await prisma.$disconnect();
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i > 0 ? p.slice(i) : '';
}

main().catch((err) => {
  console.error('Poster backfill crashed:', err);
  process.exit(1);
});
