#!/usr/bin/env node
/**
 * upload-apks-to-storage.mjs — publish fleet APKs to the object store the
 * OTA endpoints redirect to (efficiency audit 2026-09-02, P0-5).
 *
 * Two modes, one set of rules:
 *
 *   CI PUBLISH (one local file, from the release job)
 *     node scripts/upload-apks-to-storage.mjs --file <path.apk>
 *     node scripts/upload-apks-to-storage.mjs --file <path.apk> --kind player --version 1.1.12
 *
 *   BACKFILL (the last N GitHub releases, so the fleet's current build and a
 *   rollback target exist in storage BEFORE the API starts redirecting)
 *     node scripts/upload-apks-to-storage.mjs --from-releases --limit 2
 *     node scripts/upload-apks-to-storage.mjs --from-releases --kind manager --dry-run
 *
 * Flags: --dry-run (say what would happen, write nothing), --kind
 * player|manager|both, --limit N, --version x.y.z, --bucket <name>.
 *
 * ============================================================
 * THE RULES THIS SCRIPT ENFORCES
 * ============================================================
 *
 * IMMUTABLE. A version's object is written once and never overwritten
 * (`x-upsert` is never sent). Re-running against an already-published
 * version with the SAME bytes is a no-op — that is what makes the CI step
 * safe to re-run and the backfill safe to loop. Re-running against a
 * version whose stored digest DIFFERS is a hard failure with a non-zero
 * exit: it means somebody rebuilt a released version, and silently
 * replacing the bytes a screen is about to install is the one thing that
 * must never happen quietly.
 *
 * PRIVATE. The bucket is created with `public: false` and the script
 * REFUSES to write to a bucket that is public. The signed kiosk APK is not
 * something to leave world-readable at a guessable URL. The API mints
 * short-lived signed URLs for it (apps/api/src/player-ota/apk-storage.ts).
 *
 * APK FIRST, SIDECAR SECOND. The API's probe treats a readable `.sha256`
 * sidecar as evidence the object beside it is complete. Keep that ordering.
 *
 * THE SIDECAR IS NOT A TRUST ANCHOR. It records what was uploaded so this
 * tool can be idempotent and so the API can cross-check the bucket. The
 * digest a kiosk verifies against still comes from the API (the committed
 * pin in release-policy.ts, else the hash of the authenticated GitHub
 * Release bytes). A bucket that serves different bytes with a matching
 * sidecar is refused by the API, not believed.
 *
 * ============================================================
 * THE PATH LAYOUT IS A CONTRACT
 * ============================================================
 *
 *   <bucket>/player/v10112/edu-cms-player-v1.1.12.apk
 *   <bucket>/player/v10112/edu-cms-player-v1.1.12.apk.sha256
 *
 * It MUST stay byte-identical to `apkObjectPath()` in
 * apps/api/src/player-ota/apk-storage.ts. If the two drift, nothing errors:
 * every kiosk silently falls back to the byte proxy and the whole egress
 * win evaporates with no signal anywhere. apk-storage.spec.ts pins the
 * strings on the API side; this comment is the pointer on this side.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required).
 *      GH_TOKEN / GITHUB_TOKEN (required for --from-releases; the repo is
 *      private, so an anonymous release fetch 404s — the 2026-08-03 bug).
 *      PLAYER_APK_GITHUB_REPO (default gschiemann/EDUCMS).
 * Dependency-free: Node 20 globals only, so CI needs no pnpm install.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const APK_MIME = 'application/vnd.android.package-archive';
// One year + immutable: the object at a versionCode never changes, so a CDN
// or a device-side cache may hold it forever.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const BUCKET_FILE_SIZE_LIMIT = 200 * 1024 * 1024;

// ─── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const DRY_RUN = flag('dry-run');
const FILE = opt('file');
const FROM_RELEASES = flag('from-releases') || !FILE;
const LIMIT = Math.max(1, parseInt(opt('limit', '2'), 10) || 2);
const KIND_ARG = (opt('kind') || 'both').toLowerCase();
const VERSION_ARG = opt('version');
const BUCKET = opt('bucket') || process.env.PLAYER_APK_STORAGE_BUCKET || 'apks';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const GH_TOKEN = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const REPO = process.env.PLAYER_APK_GITHUB_REPO || 'gschiemann/EDUCMS';

function die(message) {
  console.error(`\n[upload-apks] ERROR: ${message}\n`);
  process.exit(1);
}
function info(message) { console.log(`[upload-apks] ${message}`); }

if (flag('help') || flag('h')) {
  console.log(await readFile(new URL(import.meta.url)).then((b) => b.toString().split('\n').slice(1, 24).join('\n')));
  process.exit(0);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.');
}

// ─── shared helpers ────────────────────────────────────────────────────

/**
 * versionName -> versionCode, the repo's `major*10000 + minor*100 + patch`
 * encoding. Same formula as Gradle, the API controller and apk-storage.ts;
 * player-ota.spec.ts locks it on the API side.
 */
function versionCodeOf(versionName) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(versionName || '');
  if (!m) return 0;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
}

/** MUST match `apkObjectPath()` in apps/api/src/player-ota/apk-storage.ts. */
function objectPath(kind, versionName) {
  return `${kind}/v${versionCodeOf(versionName)}/edu-cms-${kind}-v${versionName}.apk`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function storageHeaders(extra = {}) {
  return { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, ...extra };
}

function githubHeaders(accept = 'application/vnd.github+json') {
  const headers = { 'User-Agent': 'venueos-apk-uploader', Accept: accept };
  if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;
  return headers;
}

// ─── bucket ────────────────────────────────────────────────────────────

/**
 * Ensure a PRIVATE bucket exists. Refuses to proceed against a public one:
 * an APK that is world-readable at a guessable URL defeats the point of
 * signing the download.
 */
async function ensurePrivateBucket() {
  const getResp = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: storageHeaders() });
  if (getResp.ok) {
    const bucket = await getResp.json();
    if (bucket.public === true) {
      die(
        `bucket "${BUCKET}" is PUBLIC. Fleet APKs go in a private bucket — the API mints `
        + `short-lived signed URLs for them. Flip it to private in the Supabase dashboard `
        + `(Storage → ${BUCKET} → Settings) or point --bucket at a private one.`,
      );
    }
    info(`bucket "${BUCKET}" exists and is private.`);
    return;
  }
  if (getResp.status !== 404 && getResp.status !== 400) {
    die(`could not read bucket "${BUCKET}": HTTP ${getResp.status}`);
  }
  if (DRY_RUN) {
    info(`[dry-run] would create private bucket "${BUCKET}".`);
    return;
  }
  const createResp = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: BUCKET_FILE_SIZE_LIMIT,
      allowed_mime_types: [APK_MIME, 'text/plain'],
    }),
  });
  if (!createResp.ok) {
    const body = await createResp.text().catch(() => '');
    // A concurrent run may have won the race; that is fine.
    if (!/already exists|Duplicate/i.test(body)) {
      die(`could not create bucket "${BUCKET}": HTTP ${createResp.status} ${body.slice(0, 200)}`);
    }
  }
  info(`created private bucket "${BUCKET}".`);
}

// ─── objects ───────────────────────────────────────────────────────────

/** The digest already recorded in the bucket for this path, or null. */
async function storedSha(path) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}.sha256`, {
    headers: storageHeaders(),
  });
  if (!resp.ok) return null;
  const body = await resp.text();
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(body);
  return m ? m[1].toLowerCase() : null;
}

async function objectExists(path) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'HEAD',
    headers: storageHeaders(),
  });
  return resp.ok;
}

async function putObject(path, body, contentType) {
  // No `x-upsert` — an existing object must 409 rather than be replaced.
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL }),
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`upload ${path} failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
}

/**
 * Publish one APK. Idempotent; never overwrites; fails loudly when the
 * bucket already holds DIFFERENT bytes for this version.
 *
 * Returns 'uploaded' | 'skipped' | 'repaired' | 'would-upload'.
 */
async function publish(kind, versionName, bytes) {
  const path = objectPath(kind, versionName);
  const digest = sha256(bytes);
  const label = `${kind} v${versionName} (vc${versionCodeOf(versionName)}, ${(bytes.length / 1048576).toFixed(2)} MB)`;

  const recorded = await storedSha(path);
  if (recorded) {
    if (recorded !== digest) {
      die(
        `IMMUTABILITY VIOLATION for ${label}\n`
        + `  bucket already holds sha256 ${recorded}\n`
        + `  this artifact is    sha256 ${digest}\n`
        + `  A published version's bytes are never replaced. Somebody rebuilt a released\n`
        + `  version, or this is the wrong artifact. Cut a NEW version instead. If the\n`
        + `  stored object is genuinely wrong, delete it deliberately in the Supabase\n`
        + `  dashboard and re-run — and expect the API to have been refusing to redirect\n`
        + `  this version in the meantime (reason=sha-mismatch), which is by design.`,
      );
    }
    info(`= ${label} already published, identical bytes — nothing to do.`);
    return 'skipped';
  }

  if (DRY_RUN) {
    info(`[dry-run] would upload ${label} -> ${BUCKET}/${path} (sha256 ${digest.slice(0, 16)}…)`);
    return 'would-upload';
  }

  // A bare object with no sidecar is a half-finished upload: verify what is
  // there rather than assuming, then write only the missing sidecar.
  if (await objectExists(path)) {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: storageHeaders() });
    const existing = Buffer.from(await resp.arrayBuffer());
    const existingSha = sha256(existing);
    if (existingSha !== digest) {
      die(
        `IMMUTABILITY VIOLATION for ${label} — the object exists with sha256 ${existingSha} `
        + `but no sidecar, and this artifact hashes to ${digest}. See the note above.`,
      );
    }
    await putObject(`${path}.sha256`, `${digest}  ${basename(path)}\n`, 'text/plain');
    info(`~ ${label} object was already there; wrote the missing sidecar.`);
    return 'repaired';
  }

  // APK FIRST, SIDECAR SECOND — the API's probe reads the sidecar as
  // evidence the object beside it is complete.
  await putObject(path, bytes, APK_MIME);
  await putObject(`${path}.sha256`, `${digest}  ${basename(path)}\n`, 'text/plain');
  info(`+ ${label} published -> ${BUCKET}/${path} (sha256 ${digest.slice(0, 16)}…)`);
  return 'uploaded';
}

// ─── sources ───────────────────────────────────────────────────────────

/** `edu-cms-player-v1.1.12.apk` -> { kind, versionName }. */
function parseArtifactName(name) {
  const m = /^edu-cms-(player|manager)-v(\d+\.\d+\.\d+)\.apk$/.exec(basename(name));
  return m ? { kind: m[1], versionName: m[2] } : null;
}

async function fromLocalFile() {
  const parsed = parseArtifactName(FILE) || {};
  const kind = (KIND_ARG !== 'both' ? KIND_ARG : null) || parsed.kind;
  const versionName = VERSION_ARG || parsed.versionName;
  if (kind !== 'player' && kind !== 'manager') {
    die(`could not tell whether "${FILE}" is a player or a manager APK — pass --kind.`);
  }
  if (!versionCodeOf(versionName)) {
    die(`could not read an x.y.z version out of "${FILE}" — pass --version.`);
  }
  const bytes = await readFile(FILE).catch(() => die(`cannot read ${FILE}`));
  return [{ kind, versionName, bytes }];
}

async function fromGithubReleases() {
  if (!GH_TOKEN) {
    die('GH_TOKEN (or GITHUB_TOKEN) is required for --from-releases — the repo is private, '
      + 'so an anonymous release fetch 404s.');
  }
  const kinds = KIND_ARG === 'both' ? ['player', 'manager'] : [KIND_ARG];
  const listResp = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=60`, {
    headers: githubHeaders(),
  });
  if (!listResp.ok) die(`GitHub release list failed: HTTP ${listResp.status}`);
  const releases = await listResp.json();
  if (!Array.isArray(releases)) die('unexpected GitHub release payload.');

  const out = [];
  for (const kind of kinds) {
    // GitHub returns by internal release id, which does NOT sort by version
    // (the 2026-04-27 v1.0.9-ahead-of-v1.0.12 bug). Sort by versionCode.
    const tagged = releases
      .filter((r) => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith(`${kind}-v`))
      .map((r) => ({ release: r, versionName: r.tag_name.slice(`${kind}-v`.length) }))
      .filter((r) => versionCodeOf(r.versionName) > 0)
      .sort((a, b) => versionCodeOf(b.versionName) - versionCodeOf(a.versionName))
      .slice(0, LIMIT);

    if (!tagged.length) {
      info(`no ${kind}-v* releases found — skipping.`);
      continue;
    }
    for (const { release, versionName } of tagged) {
      const assets = release.assets || [];
      const asset = assets.find((a) => a.name === `edu-cms-${kind}-v${versionName}.apk`)
        || assets.find((a) => a.name.toLowerCase().endsWith('.apk') && !a.name.toLowerCase().includes('x86'));
      if (!asset) {
        info(`! ${kind} v${versionName} has no APK asset — skipping.`);
        continue;
      }
      if (DRY_RUN && await storedSha(objectPath(kind, versionName))) {
        // Already published: no need to pull megabytes just to say "skip".
        out.push({ kind, versionName, bytes: Buffer.alloc(0), preChecked: true });
        continue;
      }
      info(`downloading ${kind} v${versionName} from the GitHub Release…`);
      const dl = await fetch(asset.url, {
        headers: githubHeaders('application/octet-stream'),
        redirect: 'follow',
      });
      if (!dl.ok) {
        die(`could not download ${asset.name}: HTTP ${dl.status}`);
      }
      out.push({ kind, versionName, bytes: Buffer.from(await dl.arrayBuffer()) });
    }
  }
  return out;
}

// ─── main ──────────────────────────────────────────────────────────────

const mode = FROM_RELEASES ? `the last ${LIMIT} ${KIND_ARG} release(s)` : FILE;
info(`${DRY_RUN ? '[DRY RUN] ' : ''}publishing ${mode} to ${SUPABASE_URL.replace(/^https?:\/\//, '')}/${BUCKET}`);

await ensurePrivateBucket();

const artifacts = FROM_RELEASES ? await fromGithubReleases() : await fromLocalFile();
if (!artifacts.length) {
  info('nothing to publish.');
  process.exit(0);
}

const tally = { uploaded: 0, skipped: 0, repaired: 0, 'would-upload': 0 };
for (const artifact of artifacts) {
  if (artifact.preChecked) {
    info(`= ${artifact.kind} v${artifact.versionName} already published — nothing to do.`);
    tally.skipped += 1;
    continue;
  }
  tally[await publish(artifact.kind, artifact.versionName, artifact.bytes)] += 1;
}

info(
  `done — ${tally.uploaded} uploaded, ${tally.skipped} already present, `
  + `${tally.repaired} repaired${DRY_RUN ? `, ${tally['would-upload']} would upload` : ''}.`,
);
