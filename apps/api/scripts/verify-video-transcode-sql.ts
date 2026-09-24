/**
 * verify-video-transcode-sql.ts — prove the video-transcode SQL on a REAL Postgres (2026-09-23).
 *
 * The jest specs pin statement SHAPES with mocked clients; they cannot prove Postgres agrees. This
 * does, on a throwaway database that already has the schema (`prisma db push` of this branch, or
 * master + the 20260923203000_video_transcode_jobs migration):
 *
 *   VIDEO_TRANSCODE_SQL_URL='postgresql://me@127.0.0.1:55432/vt_scratch' \
 *     npx ts-node --transpile-only scripts/verify-video-transcode-sql.ts
 *
 * REFUSES to run unless the database name contains "scratch" or "sandbox" AND the host is local.
 * It never reads DATABASE_URL, so a developer's .env pointed at production cannot be picked up.
 * It creates its own tenants/users/assets under a random run id and deletes them at the end.
 * Exit 0 = every check passed.
 *
 * What it proves:
 *   1. enqueue is idempotent per asset (the unique asset_id + ON CONFLICT DO NOTHING);
 *   2. two concurrent claims never take the same row (FOR UPDATE SKIP LOCKED), and every write
 *      after the claim is lease-conditional (another owner cannot finish it);
 *   3. the stale sweep re-queues once, then fails, and expired queued rows fail — with the
 *      naive-UTC clock agreeing with Prisma's timestamps;
 *   4. release() hands a running job back and returns the attempt;
 *   5. deleting an ASSET keeps its job row (asset_id → NULL) so a retained original is not orphaned;
 *   6. statusForAssets never returns another tenant's job;
 *   7. the emergency-content SQL catches a protected playlist, a tenant's emergency playlist, a
 *      screen's per-type emergency playlist and a screen's emergency media URL — and nothing else;
 *   8. the pipeline's conditional swap write matches NOTHING for an asset in a protected playlist;
 *   9. the whole-database reference scan finds a URL embedded in a template zone's config, in a
 *      template background and in another asset row; ignores the excluded history tables; and
 *      reports "unreferenced" once those references are gone;
 *  10. the retention claim leases a due original exactly once.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  VideoTranscodeService,
  TRANSCODE_STALE_MS,
  TRANSCODE_QUEUED_EXPIRY_MS,
} from '../src/storage/video-transcode/video-transcode.service';
import { VideoTranscodePipeline } from '../src/storage/video-transcode/video-transcode.pipeline';
import {
  scanForObjectReference,
  objectNeedle,
} from '../src/storage/video-transcode/object-references';

const url = process.env.VIDEO_TRANSCODE_SQL_URL || '';

function refuse(why: string): never {
  console.error(`REFUSING: ${why}`);
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(
      `  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
    );
  }
}

async function main() {
  if (!url) refuse('set VIDEO_TRANSCODE_SQL_URL to a scratch database');
  const parsed = new URL(url);
  const db = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    parsed.hostname,
  );
  if (!/scratch|sandbox/i.test(db))
    refuse(`database "${db}" is not a scratch/sandbox database`);
  if (!local) refuse(`host "${parsed.hostname}" is not local`);

  const client = new PrismaClient({ datasources: { db: { url } } });
  const [{ current_database: current }] = await client.$queryRawUnsafe<
    Array<{ current_database: string }>
  >('SELECT current_database()');
  if (current !== db) refuse(`connected to "${current}", expected "${db}"`);
  const [{ version }] =
    await client.$queryRawUnsafe<Array<{ version: string }>>(
      'SELECT version()',
    );
  const [{ tz }] = await client.$queryRawUnsafe<Array<{ tz: string }>>(
    `SELECT current_setting('TimeZone') AS tz`,
  );
  console.log(
    `database ${current} — ${version.split(',')[0]} — session TimeZone ${tz}`,
  );

  const prisma = { client } as any;
  const svc = new VideoTranscodeService(prisma);
  const pipeline = new VideoTranscodePipeline(prisma, {} as any);
  const run = randomUUID().slice(0, 8);
  const T = (n: string) => `vt-${run}-${n}`;
  const tenants = [T('a'), T('b')];
  for (const id of tenants)
    await client.tenant.create({ data: { id, name: id, slug: id } });
  const users: Record<string, string> = {};
  for (const t of tenants) {
    const u = await client.user.create({
      data: {
        tenantId: t,
        email: `${t}@example.test`,
        passwordHash: 'x',
        role: 'SCHOOL_ADMIN' as any,
      },
    });
    users[t] = u.id;
  }
  const SUPA = 'https://example.supabase.co/storage/v1/object/public/assets/';
  const mkAsset = async (tenantId: string, n: string) => {
    const p = `${tenantId}/${randomUUID()}.mp4`;
    const a = await client.asset.create({
      data: {
        tenantId,
        uploadedByUserId: users[tenantId],
        fileUrl: `${SUPA}${p}`,
        mimeType: 'video/mp4',
        status: 'PUBLISHED',
        originalName: `${n}.mp4`,
        fileSize: 1000,
      },
    });
    return { ...a, path: p };
  };

  try {
    // ── 1. enqueue idempotent per asset ─────────────────────────────────────
    const a1 = await mkAsset(tenants[0], 'a1');
    await svc.enqueue({
      tenantId: tenants[0],
      assetId: a1.id,
      sourceUrl: a1.fileUrl,
      sourceBytes: 1000,
    });
    await svc.enqueue({
      tenantId: tenants[0],
      assetId: a1.id,
      sourceUrl: a1.fileUrl,
      sourceBytes: 1000,
    });
    check(
      'enqueue twice for one asset → exactly one row',
      (await client.videoTranscodeJob.count({ where: { assetId: a1.id } })) ===
        1,
    );

    // ── 2. concurrent claims never collide; writes are lease-conditional ────
    const a2 = await mkAsset(tenants[0], 'a2');
    await svc.enqueue({
      tenantId: tenants[0],
      assetId: a2.id,
      sourceUrl: a2.fileUrl,
      sourceBytes: 1000,
    });
    const [c1, c2, c3] = await Promise.all([
      svc.claimNext('owner-1'),
      svc.claimNext('owner-2'),
      svc.claimNext('owner-3'),
    ]);
    const claimed = [c1, c2, c3].filter(Boolean).map((c) => c!.id);
    check(
      'three concurrent claims over two queued rows → two distinct rows, one null',
      claimed.length === 2 && new Set(claimed).size === 2,
      claimed,
    );
    // Which two of the three won is up to Postgres; track each claim with its owner.
    const won = (
      [
        [c1, 'owner-1'],
        [c2, 'owner-2'],
        [c3, 'owner-3'],
      ] as const
    ).filter(([c]) => !!c) as unknown as Array<
      [NonNullable<typeof c1>, string]
    >;
    const [mine, owner] = won[0];
    check(
      'claim returns the asset + source it was queued with',
      [a1.id, a2.id].includes(mine.assetId!) && mine.sourceUrl.startsWith(SUPA),
    );
    check(
      'another owner cannot write progress on it',
      (await svc.saveProgress(mine.id, 'intruder', 50)) === false,
    );
    check(
      'another owner cannot finish it',
      (await svc.finish(mine.id, 'intruder', {
        status: 'failed',
        reason: 'x',
      })) === false,
    );
    check(
      'the owner can',
      (await svc.saveProgress(mine.id, owner, 50)) === true,
    );
    check(
      'heartbeat returns only rows this owner holds',
      (await svc.heartbeat(owner, [mine.id, 'nope'])).join() === mine.id,
    );

    // ── 3. stale sweep: re-queue once, then fail; queued expiry ─────────────
    const staleAt = new Date(Date.now() - TRANSCODE_STALE_MS - 60_000);
    await client.videoTranscodeJob.update({
      where: { id: mine.id },
      data: { heartbeatAt: staleAt },
    });
    let pw = await svc.pendingWork();
    check(
      'pendingWork sees the stale row (naive-UTC clock agrees with Prisma)',
      pw.stale === true,
      pw,
    );
    await svc.sweepStale();
    let row = await client.videoTranscodeJob.findUnique({
      where: { id: mine.id },
    });
    check(
      'first stall → re-queued',
      row?.status === 'queued' && row?.leaseOwner === null,
      row,
    );
    const again = await svc.claimNext('owner-9');
    check(
      're-claimed (attempt 2)',
      again?.id === mine.id && again?.attempts === 2,
      again,
    );
    await client.videoTranscodeJob.update({
      where: { id: mine.id },
      data: { heartbeatAt: staleAt },
    });
    await svc.sweepStale();
    row = await client.videoTranscodeJob.findUnique({ where: { id: mine.id } });
    check(
      'second stall → failed (stalled), asset untouched',
      row?.status === 'failed' && row?.reason === 'stalled',
      row,
    );
    const fresh = await client.asset.findUnique({
      where: { id: mine.assetId! },
    });
    check(
      'a failed job never changed the asset',
      fresh?.fileUrl === mine.sourceUrl,
    );

    const a3 = await mkAsset(tenants[0], 'a3');
    await svc.enqueue({
      tenantId: tenants[0],
      assetId: a3.id,
      sourceUrl: a3.fileUrl,
      sourceBytes: 1000,
    });
    await client.videoTranscodeJob.update({
      where: { assetId: a3.id },
      data: {
        createdAt: new Date(Date.now() - TRANSCODE_QUEUED_EXPIRY_MS - 60_000),
      },
    });
    await svc.sweepStale();
    row = await client.videoTranscodeJob.findUnique({
      where: { assetId: a3.id },
    });
    check(
      'a queued row older than 24 h expires',
      row?.status === 'failed' && row?.reason === 'expired',
      row,
    );

    // ── 4. release hands back + returns the attempt ─────────────────────────
    const [other, otherOwner] = won[1];
    const released = await svc.release(otherOwner);
    row = await client.videoTranscodeJob.findUnique({
      where: { id: other.id },
    });
    check(
      'release() → queued, attempt given back',
      released === 1 && row?.status === 'queued' && row?.attempts === 0,
      row,
    );

    // ── 5. deleting the asset keeps the job row ─────────────────────────────
    const a4 = await mkAsset(tenants[0], 'a4');
    await svc.enqueue({
      tenantId: tenants[0],
      assetId: a4.id,
      sourceUrl: a4.fileUrl,
      sourceBytes: 1000,
    });
    const j4 = await client.videoTranscodeJob.findUnique({
      where: { assetId: a4.id },
    });
    await client.asset.delete({ where: { id: a4.id } });
    row = await client.videoTranscodeJob.findUnique({ where: { id: j4!.id } });
    check(
      'asset deleted → job row survives with asset_id NULL (ON DELETE SET NULL)',
      !!row && row.assetId === null,
      row,
    );

    // ── 6. statusForAssets is tenant-bound ──────────────────────────────────
    const b1 = await mkAsset(tenants[1], 'b1');
    await svc.enqueue({
      tenantId: tenants[1],
      assetId: b1.id,
      sourceUrl: b1.fileUrl,
      sourceBytes: 1000,
    });
    const seenByA = await svc.statusForAssets(tenants[0], [a1.id, b1.id]);
    check(
      'tenant A asking for its asset AND tenant B’s gets only its own',
      seenByA.length === 1 && seenByA[0].assetId === a1.id,
      seenByA,
    );

    // ── 7. emergency-content SQL ────────────────────────────────────────────
    const e = await Promise.all(
      [
        'protected',
        'tenantEmergency',
        'screenPlaylist',
        'screenUrl',
        'plain',
      ].map((n) => mkAsset(tenants[0], n)),
    );
    const [pProt, pTen, pScr, pPlain] = await Promise.all(
      ['prot', 'ten', 'scr', 'plain'].map((n, i) =>
        client.playlist.create({
          data: {
            tenantId: tenants[0],
            name: `${n}-${run}`,
            isProtected: i === 0,
          },
        }),
      ),
    );
    await client.playlistItem.createMany({
      data: [
        {
          playlistId: pProt.id,
          assetId: e[0].id,
          durationMs: 1000,
          sequenceOrder: 0,
        },
        {
          playlistId: pTen.id,
          assetId: e[1].id,
          durationMs: 1000,
          sequenceOrder: 0,
        },
        {
          playlistId: pScr.id,
          assetId: e[2].id,
          durationMs: 1000,
          sequenceOrder: 0,
        },
        {
          playlistId: pPlain.id,
          assetId: e[4].id,
          durationMs: 1000,
          sequenceOrder: 0,
        },
      ],
    });
    await client.tenant.update({
      where: { id: tenants[1] },
      data: { emergencyPlaylistId: pTen.id },
    }); // another tenant names it
    const screen = await client.screen.create({
      data: {
        tenantId: tenants[0],
        name: `scr-${run}`,
        deviceFingerprint: `fp-${run}`,
        emergencyWeatherPlaylistId: pScr.id,
        emergencyLockdownAssetUrl: e[3].fileUrl,
      } as any,
    });
    const verdicts = await Promise.all(
      e.map((a) => pipeline.isEmergencyContent(a.id, a.fileUrl)),
    );
    check(
      'emergency SQL: protected playlist item → emergency',
      verdicts[0] === true,
    );
    check(
      'emergency SQL: item of a playlist a TENANT (even another one) names → emergency',
      verdicts[1] === true,
    );
    check(
      'emergency SQL: item of a screen’s per-type emergency playlist → emergency',
      verdicts[2] === true,
    );
    check(
      'emergency SQL: a screen’s emergency media URL → emergency',
      verdicts[3] === true,
    );
    check(
      'emergency SQL: an item of an ordinary playlist → NOT emergency',
      verdicts[4] === false,
    );

    // ── 8. the conditional swap write refuses a protected-playlist asset ────
    const swapProt = await client.asset.updateMany({
      where: {
        id: e[0].id,
        tenantId: tenants[0],
        fileUrl: e[0].fileUrl,
        playlistItems: { none: { playlist: { isProtected: true } } },
      },
      data: { fileUrl: `${SUPA}${tenants[0]}/optimized/x.mp4` },
    });
    const swapPlain = await client.asset.updateMany({
      where: {
        id: e[4].id,
        tenantId: tenants[0],
        fileUrl: e[4].fileUrl,
        playlistItems: { none: { playlist: { isProtected: true } } },
      },
      data: { fileSize: 999 },
    });
    check(
      'swap write on a protected-playlist asset matches NOTHING',
      swapProt.count === 0,
    );
    check('swap write on an ordinary asset matches it', swapPlain.count === 1);
    const swapStale = await client.asset.updateMany({
      where: {
        id: e[4].id,
        tenantId: tenants[0],
        fileUrl: 'https://elsewhere/old.mp4',
        playlistItems: { none: { playlist: { isProtected: true } } },
      },
      data: { fileSize: 1 },
    });
    check(
      'swap write whose source URL no longer matches → nothing',
      swapStale.count === 0,
    );

    // ── 9. the whole-database reference scan ────────────────────────────────
    const orig = await mkAsset(tenants[0], 'orig');
    const needle = objectNeedle(orig.path)!;
    let scan = await scanForObjectReference(prisma, needle);
    check(
      'the asset row itself references its own file (sanity)',
      scan.status === 'referenced' && scan.table === 'assets',
      scan,
    );
    // Swap it away, as the pipeline does.
    await client.asset.update({
      where: { id: orig.id },
      data: { fileUrl: `${SUPA}${tenants[0]}/optimized/${randomUUID()}.mp4` },
    });
    await client.auditLog.create({
      data: {
        tenantId: tenants[0],
        action: 'ASSET_VIDEO_OPTIMIZED',
        targetType: 'Asset',
        targetId: orig.id,
        details: JSON.stringify({ originalUrl: orig.fileUrl }),
      },
    });
    await client.videoTranscodeJob.create({
      data: {
        tenantId: tenants[0],
        assetId: orig.id,
        sourceUrl: orig.fileUrl,
        status: 'done',
      },
    });
    scan = await scanForObjectReference(prisma, needle);
    check(
      'only history tables (audit_logs, video_transcode_jobs) name it → UNREFERENCED',
      scan.status === 'unreferenced',
      scan,
    );
    const tpl = await client.template.create({
      data: { name: `tpl-${run}`, tenantId: tenants[0] } as any,
    });
    const zone = await client.templateZone.create({
      data: {
        templateId: tpl.id,
        name: 'Video',
        widgetType: 'VIDEO',
        defaultConfig: JSON.stringify({ assetUrl: orig.fileUrl, muted: true }),
      } as any,
    });
    scan = await scanForObjectReference(prisma, needle);
    check(
      'a template zone that embedded the URL BY VALUE → referenced (template_zones.default_config)',
      scan.status === 'referenced' &&
        scan.table === 'template_zones' &&
        scan.column === 'default_config',
      scan,
    );
    await client.templateZone.delete({ where: { id: zone.id } });
    await client.template.update({
      where: { id: tpl.id },
      data: {
        bgImage: `https://example.supabase.co/storage/v1/render/image/public/assets/${orig.path}?width=1920`,
      } as any,
    });
    scan = await scanForObjectReference(prisma, needle);
    check(
      'a transformed-image URL of the object in templates.bg_image → referenced',
      scan.status === 'referenced' && scan.table === 'templates',
      scan,
    );
    await client.template.delete({ where: { id: tpl.id } });
    await client.screen.update({
      where: { id: screen.id },
      data: { emergencyHoldPortraitAssetUrl: orig.fileUrl } as any,
    });
    scan = await scanForObjectReference(prisma, needle);
    check(
      'a screen’s emergency media column → referenced',
      scan.status === 'referenced' && scan.table === 'screens',
      scan,
    );
    await client.screen.update({
      where: { id: screen.id },
      data: { emergencyHoldPortraitAssetUrl: null } as any,
    });
    scan = await scanForObjectReference(prisma, needle);
    check(
      'references removed → UNREFERENCED again',
      scan.status === 'unreferenced',
      scan,
    );
    const bad = await scanForObjectReference(prisma, 'short');
    check(
      'a non-unique needle is refused (unknown), never "unreferenced"',
      bad.status === 'unknown',
      bad,
    );

    // ── 10. retention claim ─────────────────────────────────────────────────
    await client.videoTranscodeJob.updateMany({
      where: { assetId: orig.id },
      data: { originalDeleteAfter: new Date(Date.now() - 60_000) },
    });
    pw = await svc.pendingWork();
    check('pendingWork sees a due original', pw.originalDue === true, pw);
    const [d1, d2] = await Promise.all([
      svc.claimDueOriginal(),
      svc.claimDueOriginal(),
    ]);
    const dueClaims = [d1, d2].filter((d) => d && d.assetId === orig.id);
    check(
      'two concurrent retention claims → the due original is leased once',
      dueClaims.length === 1,
      [d1, d2],
    );
    row = await client.videoTranscodeJob.findUnique({
      where: { assetId: orig.id },
    });
    check(
      'the lease pushed original_delete_after into the future',
      !!row?.originalDeleteAfter &&
        row.originalDeleteAfter.getTime() > Date.now(),
      row,
    );
    await svc.markOriginalDeleted(row!.id);
    row = await client.videoTranscodeJob.findUnique({
      where: { assetId: orig.id },
    });
    check('markOriginalDeleted stamps it', !!row?.originalDeletedAt, row);
  } finally {
    // Clean up everything this run made (audit rows are append-only by trigger in prod; best effort).
    await client.videoTranscodeJob
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.screen
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.playlistItem
      .deleteMany({ where: { playlist: { tenantId: { in: tenants } } } })
      .catch(() => undefined);
    await client.playlist
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.template
      .deleteMany({ where: { tenantId: { in: tenants } } as any })
      .catch(() => undefined);
    await client.asset
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.auditLog
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.user
      .deleteMany({ where: { tenantId: { in: tenants } } })
      .catch(() => undefined);
    await client.tenant
      .deleteMany({ where: { id: { in: tenants } } })
      .catch(() => undefined);
    await client.$disconnect();
  }
  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nall checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
