/**
 * backfill-video-posters.ts — one-off MANUAL backfill for historical VIDEO rows:
 *   1. `Asset.posterUrl`            — a poster frame (ffmpeg), since 2026-09-11;
 *   2. `Asset.processingMeta` dims  — width × height / duration (ffprobe), since 2026-09-24.
 *
 * WHY (posters): the asset picker draws a video tile as `<video preload="none">`,
 * which paints a blank grey rectangle — the operator saw 11 real videos
 * identifiable only by a truncated filename ("every sample content is blank").
 *
 * WHY (dimensions): `Asset` has no width/height columns; the media library
 * reads `processingMeta.originalDimensions`, which only the sharp IMAGE
 * optimizer ever wrote — so a 257 MB, 1920×1080 video showed "—" for its
 * resolution (operator screenshot, 2026-09-24).
 *
 * New uploads now get BOTH automatically (VideoPosterService, fire-and-forget
 * on both upload paths). Every video uploaded before either date is missing
 * one or both; this script closes the gap. The two passes are independent — a
 * row the 2026-09-11 poster run already fixed still gets its dimensions here.
 *
 * THIS IS NOT A CRON, and it is DRY-RUN BY DEFAULT. It is:
 *   - dry-run unless you pass --apply — a bare run downloads nothing, writes
 *     nothing, and just reports what it would do;
 *   - idempotent — posters: the candidate filter is `posterUrl IS NULL` and the
 *     write re-asserts it; dimensions: the candidate filter is "no usable
 *     `originalDimensions`" and the write MERGES the probe into the existing
 *     JSON in one statement that re-asserts the same condition — so a re-run
 *     (or two runs at once) can never overwrite a value that already exists;
 *   - resumable — the summary ends with a `--after=<id>` you can hand back to
 *     continue exactly where it stopped (both passes walk ids ascending);
 *   - rate-limited — a pause between rows (default 400 ms) so a large backfill
 *     can't saturate Supabase egress or the connection pool.
 *
 * USAGE (from repo root):
 *   # preview — the default; writes nothing, downloads nothing:
 *   pnpm db:backfill-posters
 *   # real run, both passes:
 *   pnpm db:backfill-posters -- --apply
 *   # one pass only:
 *   pnpm db:backfill-posters -- --apply --only=dimensions
 *   pnpm db:backfill-posters -- --apply --only=posters
 *   # tuning:
 *   pnpm db:backfill-posters -- --apply --batch=25 --limit=100 \
 *                               --tenant=<tenantId> --delay=400 --after=<assetId>
 *
 * (or directly, from packages/database with its tsx:)
 *   pnpm --filter @cms/database exec tsx ../../scripts/backfill-video-posters.ts
 *
 * REQUIRES: `ffmpeg` AND `ffprobe` on PATH (the production image has both; on
 * a Mac, `brew install ffmpeg` installs both) and env DATABASE_URL,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — the same vars the API uses. Never
 * hardcode them.
 *
 * ⚠️ Point it at the database in your env and nothing else. There is no
 * `--force`/`--prod` affordance on purpose: the safety here is that the
 * default run cannot change anything.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import {
  runPosterBackfill,
  type BackfillAssetRow,
  type MakePosterResult,
} from '../apps/api/src/storage/video-poster-backfill';
import { runProbeBackfill } from '../apps/api/src/storage/video-probe-backfill';
import {
  extractVideoPosterFromBuffer,
  extractVideoPosterFromUrl,
  POSTER_EXT,
  POSTER_MIME,
} from '../apps/api/src/storage/video-poster';
import {
  buildProbeMeta,
  probeVideoFromBuffer,
  probeVideoFromUrl,
  type ProbeOutcome,
} from '../apps/api/src/storage/video-probe';

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
/** `--only=posters` | `--only=dimensions`; default runs both, posters first. */
const ONLY = strFlag('only');
if (ONLY && ONLY !== 'posters' && ONLY !== 'dimensions') {
  console.error(`--only must be "posters" or "dimensions" (got "${ONLY}"). Aborting.`);
  process.exit(1);
}

/**
 * Recover the bucket-relative path from a stored Supabase object URL.
 * Mirrors SupabaseStorageService.parseObjectUrl. Returns null for anything
 * that isn't an object in OUR bucket — an external/CDN URL added via
 * `POST /assets/url` has bytes we don't own, and we never hand a stored
 * third-party URL to ffmpeg or ffprobe.
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

/**
 * "This video row still has no usable dimensions" — as SQL, because Prisma's
 * JSON filters cannot express "key missing or not a number" and the SAME
 * predicate has to sit inside the UPDATE that writes them (see `persistDims`):
 * the guard and the write in one statement is what makes the pass idempotent
 * under a concurrent run or an upload-time probe. `jsonb_typeof(NULL)` is
 * NULL, so a NULL column, an empty object and a missing key all qualify.
 */
const NO_USABLE_DIMS = Prisma.sql`jsonb_typeof(processing_meta->'originalDimensions'->'w') IS DISTINCT FROM 'number'`;

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
  const trustedPrefix = `${supaUrl}/storage/v1/object/public/${BUCKET}/`;
  const loopOpts = { dryRun: !APPLY, batch: BATCH, limit: LIMIT, delayMs: DELAY_MS, afterId: AFTER };
  let wouldWrite = 0;

  // ── pass 1: posters ────────────────────────────────────────────────────
  if (ONLY !== 'dimensions') {
    const where: any = { posterUrl: null, mimeType: { startsWith: 'video/' } };
    if (TENANT) where.tenantId = TENANT;

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
      loopOpts,
    );
    wouldWrite += summary.posted;
  }

  // ── pass 2: dimensions ─────────────────────────────────────────────────
  if (ONLY !== 'posters') {
    const tenantClause = TENANT ? Prisma.sql` AND tenant_id = ${TENANT}` : Prisma.empty;
    const candidateWhere = Prisma.sql`mime_type LIKE 'video/%' AND ${NO_USABLE_DIMS}${tenantClause}`;

    const summary = await runProbeBackfill(
      {
        countCandidates: async () => {
          const rows = await prisma.$queryRaw<Array<{ count: number }>>(
            Prisma.sql`SELECT count(*)::int AS count FROM assets WHERE ${candidateWhere}`,
          );
          return rows[0]?.count ?? 0;
        },
        fetchBatch: (afterId, take) =>
          prisma.$queryRaw<BackfillAssetRow[]>(
            Prisma.sql`SELECT id, tenant_id AS "tenantId", file_url AS "fileUrl",
                              mime_type AS "mimeType", original_name AS "originalName"
                         FROM assets
                        WHERE ${candidateWhere}${afterId ? Prisma.sql` AND id > ${afterId}` : Prisma.empty}
                        ORDER BY id ASC
                        LIMIT ${take}`,
          ),
        storagePathFor: (row) => pathFromObjectUrl(row.fileUrl),
        probe: async (row, storagePath): Promise<ProbeOutcome> => {
          try {
            // ffprobe reads the container index over http — a few hundred KB,
            // never the frames. Full download only if that fails.
            const url = `${trustedPrefix}${storagePath}`;
            const viaUrl = await probeVideoFromUrl(url, trustedPrefix);
            if (viaUrl.ok) return viaUrl;
            const bytes = await download(storagePath, supaUrl, supaKey);
            if (!bytes) return { ok: false, reason: `url:${viaUrl.reason}; download-miss` };
            const viaBytes = await probeVideoFromBuffer(bytes, extOf(storagePath));
            return viaBytes.ok
              ? viaBytes
              : { ok: false, reason: `url:${viaUrl.reason}; bytes:${viaBytes.reason}` };
          } catch (e: any) {
            return { ok: false, reason: `threw: ${e?.message ?? e}` };
          }
        },
        // Tenant-scoped, MERGE (jsonb `||` keeps every key the probe does not
        // own, exactly like the API's mergeProbeMeta), and re-asserts "still no
        // usable dimensions" in the same statement: the idempotency lock. A
        // non-object value in the column (never written by us, but possible)
        // is treated as empty rather than making `||` throw.
        persist: (row, p) =>
          prisma.$executeRaw(
            Prisma.sql`UPDATE assets
                          SET processing_meta = (CASE WHEN jsonb_typeof(processing_meta) = 'object'
                                                      THEN processing_meta ELSE '{}'::jsonb END)
                                                || ${JSON.stringify(buildProbeMeta(p))}::jsonb,
                              updated_at = now()
                        WHERE id = ${row.id} AND tenant_id = ${row.tenantId}
                          AND ${NO_USABLE_DIMS}`,
          ),
        log: (line) => console.log(line),
        sleep,
      },
      loopOpts,
    );
    wouldWrite += summary.probed;
  }

  if (!APPLY && wouldWrite > 0) {
    console.log('\n  This was a DRY RUN. Re-run with --apply to write.');
  }

  await prisma.$disconnect();
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i > 0 ? p.slice(i) : '';
}

main().catch((err) => {
  console.error('Video backfill crashed:', err);
  process.exit(1);
});
