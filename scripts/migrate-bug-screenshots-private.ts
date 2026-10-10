/**
 * migrate-bug-screenshots-private.ts — move legacy bug-report screenshots out
 * of the PUBLIC `bug-screenshots` bucket into the PRIVATE
 * `bug-screenshots-private` bucket (2026-10-10).
 *
 * WHY: a bug screenshot is a capture of an operator's dashboard (customer
 * names, screen lists, school data). Until 2026-10-10 they were uploaded to a
 * public bucket, so anyone holding a link could open them forever. New uploads
 * now go to the private bucket and the API only ever returns short-TTL signed
 * URLs (apps/api/src/bugs/bug-screenshot-url.ts) — legacy rows are signed on
 * read too, so the dashboard keeps working before AND after this script runs.
 * This script closes the remaining hole: the legacy OBJECTS are still public.
 *
 * WHAT IT DOES, per `Bug` row whose `screenshot_url` points at the legacy
 * public bucket:
 *   1. download the object with the service-role key;
 *   2. upload the same bytes to the private bucket at the SAME path (upsert —
 *      re-running after a partial run rewrites identical bytes);
 *   3. read the private copy back and compare its size;
 *   4. point the row at `…/object/bug-screenshots-private/<path>` in ONE
 *      conditional write (`WHERE id = … AND screenshot_url = <old>`), so a
 *      re-run or a concurrent run can never clobber a newer value;
 *   5. ONLY with `--delete-source`: delete the legacy public object after the
 *      row has moved. Without it the old object stays (still public) — run
 *      once without, check the dashboard, then again with `--delete-source`
 *      (rows already moved are skipped; their legacy objects are found from
 *      the private URL's path and removed).
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. A bare run downloads nothing and writes nothing; it
 *     lists what it would do. Pass `--apply` to act.
 *   - Idempotent + resumable: candidates are selected by the stored URL shape,
 *     the row write re-asserts the old value, uploads are upserts.
 *   - It touches the database in your env. Point it at the database you mean;
 *     there is no production shortcut on purpose.
 *
 * USAGE (from repo root; `pnpm db:migrate-bug-screenshots [-- --apply]` is the shortcut):
 *   pnpm --filter @cms/database exec tsx ../../scripts/migrate-bug-screenshots-private.ts
 *   pnpm --filter @cms/database exec tsx ../../scripts/migrate-bug-screenshots-private.ts --apply
 *   pnpm --filter @cms/database exec tsx ../../scripts/migrate-bug-screenshots-private.ts --apply --delete-source
 *   options: --limit=<n>  --delay=<ms between rows, default 200>
 *
 * REQUIRES env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the same
 * vars the API uses — never hardcode them). The private bucket is created by
 * the API at boot; deploy the API first.
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const LEGACY_BUCKET = 'bug-screenshots';
const PRIVATE_BUCKET = 'bug-screenshots-private';

const argv = process.argv.slice(2);
const hasFlag = (name: string) => argv.includes(`--${name}`);
const numFlag = (name: string, def: number): number => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

const APPLY = hasFlag('apply');
const DELETE_SOURCE = hasFlag('delete-source');
const LIMIT = numFlag('limit', 0);
const DELAY_MS = numFlag('delay', 200);

/** `{ bucket, path }` from a stored Supabase object URL (public or private shape). */
function parseObjectUrl(objectUrl: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(objectUrl);
    const marker = '/storage/v1/object/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    const rest = u.pathname.slice(idx + marker.length).replace(/^(public|sign|authenticated)\//, '');
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
  } catch {
    return null;
  }
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (APPLY && (!url || !key)) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required with --apply');
  if (DELETE_SOURCE && !APPLY) throw new Error('--delete-source only makes sense with --apply');

  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  const prisma = new PrismaClient();
  const counts = { candidates: 0, moved: 0, raced: 0, failed: 0, sourceDeleted: 0, alreadyPrivate: 0 };

  try {
    const legacyRows = await prisma.bug.findMany({
      where: { screenshotUrl: { contains: `/storage/v1/object/public/${LEGACY_BUCKET}/` } },
      select: { id: true, screenshotUrl: true },
      orderBy: { id: 'asc' },
      ...(LIMIT ? { take: LIMIT } : {}),
    });
    counts.candidates = legacyRows.length;
    console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: ${legacyRows.length} bug row(s) still on the public bucket`);

    for (const row of legacyRows) {
      const oldUrl = row.screenshotUrl!;
      const parsed = parseObjectUrl(oldUrl);
      if (!parsed || parsed.bucket !== LEGACY_BUCKET) {
        console.warn(`  skip ${row.id}: unrecognised URL`);
        counts.failed++;
        continue;
      }
      const newUrl = `${url || new URL(oldUrl).origin}/storage/v1/object/${PRIVATE_BUCKET}/${parsed.path}`;
      if (!APPLY) {
        console.log(`  would move ${row.id}: ${LEGACY_BUCKET}/${parsed.path} → ${PRIVATE_BUCKET}/${parsed.path}`);
        continue;
      }
      try {
        const get = await fetch(`${url}/storage/v1/object/${LEGACY_BUCKET}/${encodePath(parsed.path)}`, { headers: auth });
        if (!get.ok) throw new Error(`download ${get.status}`);
        const contentType = get.headers.get('content-type') || 'image/png';
        const bytes = new Uint8Array(await get.arrayBuffer());

        const put = await fetch(`${url}/storage/v1/object/${PRIVATE_BUCKET}/${encodePath(parsed.path)}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true' },
          body: new Blob([bytes]),
        });
        if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0, 200)}`);

        const check = await fetch(`${url}/storage/v1/object/${PRIVATE_BUCKET}/${encodePath(parsed.path)}`, { headers: auth });
        const copied = check.ok ? (await check.arrayBuffer()).byteLength : -1;
        if (copied !== bytes.byteLength) throw new Error(`verify: private copy is ${copied} bytes, source ${bytes.byteLength}`);

        const res = await prisma.bug.updateMany({
          where: { id: row.id, screenshotUrl: oldUrl },
          data: { screenshotUrl: newUrl },
        });
        if (res.count === 1) {
          counts.moved++;
          console.log(`  moved ${row.id}`);
        } else {
          counts.raced++;
          console.log(`  ${row.id}: row changed under us — left as is`);
        }
      } catch (e: any) {
        counts.failed++;
        console.warn(`  FAILED ${row.id}: ${e?.message ?? e}`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }

    if (DELETE_SOURCE) {
      // Every row already on the private bucket: remove its legacy public twin
      // (a 404/400 means it is already gone — idempotent).
      const moved = await prisma.bug.findMany({
        where: { screenshotUrl: { contains: `/storage/v1/object/${PRIVATE_BUCKET}/` } },
        select: { id: true, screenshotUrl: true },
        orderBy: { id: 'asc' },
      });
      counts.alreadyPrivate = moved.length;
      for (const row of moved) {
        const parsed = parseObjectUrl(row.screenshotUrl!);
        if (!parsed) continue;
        const del = await fetch(`${url}/storage/v1/object/${LEGACY_BUCKET}`, {
          method: 'DELETE',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [parsed.path] }),
        });
        if (del.ok) {
          const removed = (await del.json().catch(() => [])) as unknown[];
          if (Array.isArray(removed) && removed.length) counts.sourceDeleted++;
        } else {
          console.warn(`  could not delete legacy object for ${row.id}: ${del.status}`);
        }
        if (DELAY_MS) await sleep(DELAY_MS);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(JSON.stringify(counts));
  if (counts.failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
