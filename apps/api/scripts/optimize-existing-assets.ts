/**
 * One-time (re-runnable) backfill: shrink media ALREADY in Supabase Storage.
 *
 * The MediaOptimizationService now optimizes media at upload, but everything
 * uploaded before that ships at full size (the 8.7MB PNGs / 40MB videos behind
 * the egress bill). This downloads each oversized object, optimizes it, and
 * re-uploads it IN PLACE — same storage path, same public URL.
 *
 * Why in-place (not a new path): asset URLs are embedded in ~20 places —
 * Template.bgImage, zone configs, Sponsor.logoUrl, and 12 life-safety
 * Screen.emergency*AssetUrl columns. Changing the URL would mean rewriting all
 * of them and risking a broken image on a screen (or worse, a broken emergency
 * asset). Keeping the URL stable means ZERO reference rewrites: images are
 * re-stored as WebP bytes served with an `image/webp` content-type — browsers,
 * the Taurus, and the player all render by content-type, not the .png/.jpg
 * extension, so the URL stays valid. Only the Asset row's size/mime/hash are
 * updated (so the player SW re-caches the small version once via hash diff).
 *
 * SAFETY:
 *  - SKIPS any object whose path contains "/emergency/" — life-safety media is
 *    left untouched per the emergency-change rule. Re-run with
 *    --include-emergency only after explicit review.
 *  - SKIPS branding favicons/SVG/ICO and anything that doesn't get smaller.
 *  - --dry  : download + optimize + report projected savings, NO writes.
 *  - --limit N : process only the N largest candidates (test-one-first).
 *  - Idempotent: re-encoding an already-optimized object won't get smaller,
 *    so it's skipped.
 *
 * Run (after the API with MediaOptimizationService + ffmpeg is deployed, OR
 * locally where ffmpeg is installed):
 *   pnpm --filter api optimize-existing -- --dry            # projection
 *   pnpm --filter api optimize-existing -- --limit 1        # do the largest
 *   pnpm --filter api optimize-existing                     # do them all
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { MediaOptimizationService } from '../src/storage/media-optimization.service';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();
const media = new MediaOptimizationService();

const BUCKET = 'assets';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const DRY = hasFlag('--dry') || hasFlag('--dry-run');
const INCLUDE_EMERGENCY = hasFlag('--include-emergency');
const LIMIT = intFlag('--limit', 0); // 0 = no limit
const MIN_BYTES = intFlag('--min-bytes', 300 * 1024); // ignore anything already small

const SUPABASE_URL = reqEnv('SUPABASE_URL').replace(/\/+$/, '');
const KEY = reqEnv('SUPABASE_SERVICE_ROLE_KEY');

interface Obj { name: string; size: number; mime: string }

async function listObjects(): Promise<Obj[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string; size: any; mime: string }>>(
    `SELECT name,
            (metadata->>'size')::bigint AS size,
            COALESCE(metadata->>'mimetype', '') AS mime
       FROM storage.objects
      WHERE bucket_id = $1`,
    BUCKET,
  );
  return rows
    .map((r) => ({ name: r.name, size: Number(r.size) || 0, mime: r.mime }))
    .filter((o) => o.size >= MIN_BYTES)
    .filter((o) => INCLUDE_EMERGENCY || !o.name.includes('/emergency/'))
    .filter((o) => media.isOptimizableImage(o.mime) || media.isOptimizableVideo(o.mime))
    .sort((a, b) => b.size - a.size);
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

async function download(name: string): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(name)}`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function reupload(name: string, buf: Buffer, contentType: string): Promise<void> {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'x-upsert': 'true',
      'Cache-Control': IMMUTABLE,
    },
    body: new Blob([ab]),
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
}

const mb = (n: number) => (n / 1048576).toFixed(2) + 'MB';

async function main() {
  let objects = await listObjects();
  if (LIMIT > 0) objects = objects.slice(0, LIMIT);

  console.log(
    `${objects.length} optimizable object(s) ≥ ${mb(MIN_BYTES)}` +
      `${INCLUDE_EMERGENCY ? '' : ' (emergency/ excluded)'}.` +
      `${DRY ? '  DRY RUN — no writes.' : ''}`,
  );

  let origTotal = 0;
  let newTotal = 0;
  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const o of objects) {
    try {
      const { buf } = await download(o.name);
      const ext = extOf(o.name);
      // keepFormat:false → images become WebP (the big win); video → mp4.
      const opt = await media.optimize(buf, o.mime, ext, { keepFormat: false });
      if (!opt.optimized) {
        skipped++;
        continue;
      }
      origTotal += opt.originalBytes;
      newTotal += opt.finalBytes;
      const pct = ((1 - opt.finalBytes / opt.originalBytes) * 100).toFixed(0);
      console.log(`  ${o.name}\n    ${mb(opt.originalBytes)} → ${mb(opt.finalBytes)} (${pct}% smaller, ${opt.mimeType})`);

      if (DRY) {
        changed++;
        continue;
      }

      // Re-store IN PLACE with the optimized bytes + new content-type.
      await reupload(o.name, opt.buffer, opt.mimeType);

      // Update the matching Asset row (if any) so the manifest + SW pick up
      // the new size/mime/hash. Non-Asset objects (branding, etc.) keep
      // working — the URL is unchanged.
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${o.name}`;
      const sha = createHash('sha256').update(opt.buffer).digest('hex');
      await prisma.asset.updateMany({
        where: { fileUrl: publicUrl },
        data: { fileSize: opt.finalBytes, mimeType: opt.mimeType, fileHash: sha },
      });
      changed++;
    } catch (e: any) {
      failed++;
      console.error(`  FAILED ${o.name}: ${e?.message || e}`);
    }
  }

  const saved = origTotal - newTotal;
  console.log(
    `\n${DRY ? 'Projected' : 'Done'}: ${changed} ${DRY ? 'would shrink' : 'shrunk'}, ` +
      `${skipped} already optimal, ${failed} failed.\n` +
      `${DRY ? 'Would save' : 'Saved'} ${mb(saved)} per full fetch of these assets ` +
      `(${mb(origTotal)} → ${mb(newTotal)}).`,
  );
}

function hasFlag(f: string): boolean { return process.argv.includes(f); }
function intFlag(f: string, def: number): number {
  const i = process.argv.indexOf(f);
  if (i >= 0 && process.argv[i + 1]) { const v = parseInt(process.argv[i + 1], 10); if (Number.isFinite(v)) return v; }
  return def;
}
function reqEnv(n: string): string { const v = process.env[n]; if (!v) throw new Error(`Missing env ${n}`); return v; }

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
