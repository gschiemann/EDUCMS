/**
 * One-time maintenance: stamp a long, immutable Cache-Control header onto
 * every asset already living in Supabase Storage.
 *
 * WHY: assets uploaded before the supabase-storage.service.ts fix were
 * stored with NO cache-control, so Supabase serves them `cache-control:
 * no-cache`. Cloudflare refuses to cache them (`cf-cache-status: MISS`) and
 * every dashboard view, preview, player sync and CI run re-downloads the
 * full file. Result: ~12GB egress on ~256MB of stored assets (each served
 * ~46×) — the overage that triggered the Supabase quota email.
 *
 * Our filenames are content-addressed UUIDs — an asset at a given path never
 * changes — so they are safe to cache forever. This script re-uploads each
 * existing object with `Cache-Control: public, max-age=31536000, immutable`
 * (an in-place upsert; the public URL is unchanged). After it runs, the next
 * fetch of each asset populates Cloudflare and all subsequent fetches are
 * edge cache hits.
 *
 * SAFE TO RE-RUN: it HEADs each asset first and skips anything already marked
 * `immutable`, so a second run moves zero bytes.
 *
 * Run:
 *   pnpm --filter api recache-assets          # do it
 *   pnpm --filter api recache-assets -- --dry  # list what WOULD change
 *
 * Needs DATABASE_URL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env
 * (the API's normal .env). One-time egress cost ≈ the total stored size
 * (~256MB) — negligible vs. the recurring 12GB/mo it stops.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Runs outside Nest's ConfigModule, so load .env ourselves. Try both the
// api-local and repo-root .env (without override) so whichever holds the
// SUPABASE_* / DATABASE_URL keys is picked up.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

const BUCKET = 'assets';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

/** Pull the storage path out of a public URL; null if it isn't one of ours. */
function pathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith(PUBLIC_PREFIX)) return null;
  // strip any query string (signed/cache-buster params)
  return decodeURIComponent(url.slice(PUBLIC_PREFIX.length).split('?')[0]);
}

async function collectPaths(): Promise<Set<string>> {
  const paths = new Set<string>();

  // Source of truth = the actual contents of the bucket. Enumerating
  // storage.objects (rather than the app tables) guarantees we cover EVERY
  // object — including orphans and sponsor logos stored in GameEvent JSON
  // that have no row in Asset/TenantBranding/FloorPlan. `name` is the path
  // within the bucket.
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM storage.objects WHERE bucket_id = $1`,
      BUCKET,
    );
    rows.forEach((r) => {
      if (r?.name) paths.add(r.name);
    });
    if (paths.size > 0) return paths;
  } catch (e: any) {
    console.warn(
      `Could not enumerate storage.objects directly (${e?.message || e}); ` +
        `falling back to app-table URLs.`,
    );
  }

  // Fallback: derive paths from the app tables' public URLs.
  const add = (u: string | null | undefined) => {
    const p = pathFromUrl(u);
    if (p) paths.add(p);
  };
  const assets = await prisma.asset.findMany({ select: { fileUrl: true } });
  assets.forEach((a) => add(a.fileUrl));
  try {
    const brands = await (prisma as any).tenantBranding.findMany({
      select: { logoUrl: true, faviconUrl: true },
    });
    brands.forEach((b: any) => {
      add(b.logoUrl);
      add(b.faviconUrl);
    });
  } catch {
    /* model not present — skip */
  }
  try {
    const plans = await (prisma as any).floorPlan.findMany({ select: { imageUrl: true } });
    plans.forEach((p: any) => add(p.imageUrl));
  } catch {
    /* model not present — skip */
  }

  return paths;
}

/**
 * Already cacheable? Check the STORED cache_control via the object `info`
 * endpoint — NOT the served response header. Supabase's storage gateway
 * (sb-gateway-mode: direct) serves `cache-control: no-cache` to clients
 * regardless of stored metadata, so a HEAD of the public URL is useless for
 * this check; the metadata column is the source of truth.
 */
async function alreadyImmutable(path: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/info/public/${BUCKET}/${encodeURI(path)}`,
      { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } },
    );
    if (!res.ok) return false;
    const j: any = await res.json();
    const cc = j?.cache_control ?? j?.cacheControl ?? j?.metadata?.cacheControl ?? '';
    return String(cc).includes('immutable');
  } catch {
    return false;
  }
}

async function recacheOne(path: string): Promise<number> {
  // Download bytes from the authenticated object endpoint.
  const dl = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const contentType = dl.headers.get('content-type') || 'application/octet-stream';
  const ab = await dl.arrayBuffer();

  // Re-upload in place with the immutable header (upsert = overwrite).
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': contentType,
      'Content-Length': String(ab.byteLength),
      'x-upsert': 'true',
      'Cache-Control': IMMUTABLE,
    },
    body: new Blob([ab]),
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  return ab.byteLength;
}

async function main() {
  const paths = await collectPaths();
  console.log(`Found ${paths.size} Supabase-hosted asset path(s).${DRY ? ' (DRY RUN)' : ''}`);

  let changed = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const path of paths) {
    if (await alreadyImmutable(path)) {
      skipped++;
      continue;
    }
    if (DRY) {
      console.log(`would re-cache: ${path}`);
      changed++;
      continue;
    }
    try {
      const n = await recacheOne(path);
      bytes += n;
      changed++;
      console.log(`re-cached (${(n / 1_048_576).toFixed(1)}MB): ${path}`);
    } catch (e: any) {
      failed++;
      console.error(`FAILED ${path}: ${e?.message || e}`);
    }
  }

  console.log(
    `\nDone. ${changed} ${DRY ? 'would change' : 're-cached'}, ${skipped} already immutable, ` +
      `${failed} failed. ${DRY ? '' : `Moved ${(bytes / 1_048_576).toFixed(1)}MB.`}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
