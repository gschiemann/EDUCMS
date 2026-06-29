/**
 * One-time migration: move existing floor-plan images out of the PUBLIC
 * `assets` bucket into the PRIVATE `floor-plans` bucket (launch-readiness P1).
 *
 * WHY: floor plans are operational-security data (building layouts + emergency
 * exits). They were originally uploaded to the public, CDN-cacheable `assets`
 * bucket at `${tenantId}/floor-plans/...`, so a leaked URL exposes a building
 * layout to the world forever. The API already re-signs floor-plan URLs on
 * read (short-TTL signed URLs), but the underlying object is still
 * world-readable in a public bucket. This script copies each existing
 * floor-plan object into the new private bucket and repoints the FloorPlan row.
 *
 * After the app deploys (which creates the private `floor-plans` bucket on
 * boot), run this ONCE against prod:
 *
 *   pnpm --filter api exec ts-node scripts/migrate-floorplans-to-private.ts
 *   pnpm --filter api exec ts-node scripts/migrate-floorplans-to-private.ts -- --dry   # preview only
 *
 * Needs DATABASE_URL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env
 * (the API's normal .env).
 *
 * SAFE TO RE-RUN: it skips any FloorPlan whose imageUrl already points at the
 * private `floor-plans` bucket, and copies are upserts, so a second run moves
 * zero new rows. Egress cost ≈ total floor-plan image size (typically a few MB).
 *
 * AFTER it runs and you've verified floor plans still display in the dashboard,
 * the now-orphaned source objects under `assets/<tenant>/floor-plans/*` can be
 * deleted to reclaim space and remove the public copy entirely, e.g.:
 *   DELETE FROM storage.objects
 *     WHERE bucket_id = 'assets' AND name LIKE '%/floor-plans/%';
 * (Do this only AFTER confirming every FloorPlan.imageUrl now points at the
 * private bucket — the query below prints a summary you can check.)
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

const PUBLIC_BUCKET = 'assets';
const PRIVATE_BUCKET = 'floor-plans';
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const KEY = env('SUPABASE_SERVICE_ROLE_KEY');

/**
 * Recover { bucket, path } from a stored Supabase object URL. Mirrors
 * SupabaseStorageService.parseObjectUrl so this script needs no Nest bootstrap.
 */
function parseObjectUrl(objectUrl: string | null | undefined): { bucket: string; path: string } | null {
  if (typeof objectUrl !== 'string' || !objectUrl) return null;
  try {
    const u = new URL(objectUrl);
    const marker = '/storage/v1/object/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    let rest = u.pathname.slice(idx + marker.length);
    rest = rest.replace(/^(public|sign|authenticated)\//, '');
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const bucket = rest.slice(0, slash);
    const path = rest.slice(slash + 1);
    if (!bucket || !path) return null;
    return { bucket, path: decodeURIComponent(path) };
  } catch {
    return null;
  }
}

/** Download an object's bytes from a bucket via the service-role endpoint. */
async function download(bucket: string, objPath: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURI(objPath)}`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  });
  if (!res.ok) {
    console.warn(`  download ${bucket}/${objPath} failed: ${res.status}`);
    return null;
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const ab = await res.arrayBuffer();
  return { buf: Buffer.from(ab), contentType };
}

/** Upload bytes into a bucket (upsert) via the service-role endpoint. */
async function upload(bucket: string, objPath: string, buf: Buffer, contentType: string): Promise<boolean> {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURI(objPath)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'x-upsert': 'true',
      'cache-control': 'max-age=31536000',
    },
    body: new Blob([ab]),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`  upload ${bucket}/${objPath} failed: ${res.status} ${body.slice(0, 160)}`);
    return false;
  }
  return true;
}

/** Stored (private) URL shape for the new bucket. */
function privateObjectUrl(objPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${PRIVATE_BUCKET}/${objPath}`;
}

async function main() {
  console.log(`Floor-plan privacy migration ${DRY ? '(DRY RUN — no writes)' : ''}`);
  console.log(`  ${PUBLIC_BUCKET} → ${PRIVATE_BUCKET}\n`);

  const plans = await (prisma as any).floorPlan.findMany({
    select: { id: true, tenantId: true, name: true, imageUrl: true },
  });
  console.log(`Found ${plans.length} floor plan(s).\n`);

  let migrated = 0;
  let alreadyPrivate = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    const parsed = parseObjectUrl(plan.imageUrl);
    if (!parsed) {
      console.warn(`SKIP ${plan.id} (${plan.name}): unrecognized imageUrl ${plan.imageUrl}`);
      skipped++;
      continue;
    }
    if (parsed.bucket === PRIVATE_BUCKET) {
      alreadyPrivate++;
      continue;
    }
    if (parsed.bucket !== PUBLIC_BUCKET) {
      console.warn(`SKIP ${plan.id} (${plan.name}): imageUrl in unexpected bucket "${parsed.bucket}"`);
      skipped++;
      continue;
    }

    console.log(`MIGRATE ${plan.id} (${plan.name}): ${parsed.bucket}/${parsed.path}`);
    if (DRY) {
      migrated++;
      continue;
    }

    const dl = await download(PUBLIC_BUCKET, parsed.path);
    if (!dl) {
      failed++;
      continue;
    }
    const ok = await upload(PRIVATE_BUCKET, parsed.path, dl.buf, dl.contentType);
    if (!ok) {
      failed++;
      continue;
    }
    await (prisma as any).floorPlan.update({
      where: { id: plan.id },
      data: { imageUrl: privateObjectUrl(parsed.path) },
    });
    console.log(`  → repointed to ${PRIVATE_BUCKET}/${parsed.path} (${dl.buf.length} bytes)`);
    migrated++;
  }

  console.log(`\nSummary:`);
  console.log(`  migrated:        ${migrated}${DRY ? ' (would migrate)' : ''}`);
  console.log(`  already private: ${alreadyPrivate}`);
  console.log(`  skipped:         ${skipped}`);
  console.log(`  failed:          ${failed}`);
  if (!DRY && failed === 0 && migrated > 0) {
    console.log(
      `\nAll floor plans now point at the private "${PRIVATE_BUCKET}" bucket. After you\n` +
        `confirm they still display in the dashboard, you may delete the now-orphaned\n` +
        `public copies (see the header comment for the exact DELETE).`,
    );
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
