'use strict';
/**
 * The `finish` guard for a DEVICE_JWT_SECRET rotation window (2026-10-23).
 *
 * THE INCIDENT IT PREVENTS. `scripts/railway-rotation.mjs finish` removed
 * `DEVICE_JWT_SECRET_PREVIOUS` a few hours after `start`, on the runbook's
 * assumption that "screens hold 1-hour device tokens and renew every ~10
 * minutes". A PAIRED screen holds a 180-day token and re-registers only when
 * its page loads or when < 14 days remain (apps/web/src/app/player/
 * deviceCredential.ts). Every screen that did not reload inside the window
 * still held a token signed by the old key, and lost its sign-in the moment
 * the window closed.
 *
 * THE RULE. `finish` refuses to close the window while any paired screen that
 * was alive in the last 24 hours has not been issued a token signed by the NEW
 * primary. The API stamps every token issue's audit row with `mintKeyId`, a
 * non-secret id of the key that signed it (`keyIdOf` in
 * apps/api/src/security/key-ring.ts): `SCREEN_TOKEN_RENEWED` /
 * `SCREEN_TOKEN_DOWNGRADED` (POST /screens/register) and `DEVICE_PAIRED`
 * (POST /devices/pair). This script computes the same id from the Railway
 * variable — the key itself is never printed — and looks for a row carrying
 * it. A timestamp could not answer the question: until the deploy carrying the
 * new primary is live, and during the rolling overlap after it, the OLD
 * container keeps minting on the old key and writing the very same rows.
 *
 * "Alive" is the newest of `last_ping_at`, `player_version_at` and
 * `manager_version_at`: a screen whose player cannot authenticate still has a
 * Manager app checking in, and it is exactly the screen that would go dark.
 *
 * The override is explicit and LOGGED: it needs a reason, and it writes an
 * immutable `KEY_ROTATION_FINISH_OVERRIDE` row (system tenant) BEFORE anything
 * is removed — if that row cannot be written, nothing is removed.
 *
 * Pure helpers + two small DB calls behind an injected client, so
 * `scripts/__tests__/rotation-renewal-guard.test.cjs` runs with no database.
 * Read-only against production except the override row.
 */

const crypto = require('node:crypto');
const path = require('node:path');

/** Every audit action written when a screen is handed a freshly minted device token. */
const TOKEN_ISSUE_ACTIONS = Object.freeze(['SCREEN_TOKEN_RENEWED', 'SCREEN_TOKEN_DOWNGRADED', 'DEVICE_PAIRED']);

/** A screen counts if it showed a sign of life this recently. */
const ACTIVE_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the audit scan looks for a token issued on the new key. Only a
 * bound on the scan — a key id is unique to its rotation — sized far beyond
 * any window anyone should leave open.
 */
const ISSUE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const OVERRIDE_AUDIT_ACTION = 'KEY_ROTATION_FINISH_OVERRIDE';
const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_TENANT_NAME = 'System (security events)';
const SYSTEM_TENANT_SLUG = '__system__';

/** The production CA pinned in the repo (packages/database/certs/README.md). */
const DEFAULT_CA_PATH = path.resolve(__dirname, '..', 'packages', 'database', 'certs', 'supabase-prod-ca-2021.crt');

/**
 * MUST match `keyIdOf` in apps/api/src/security/key-ring.ts byte for byte —
 * both test suites pin the same vector.
 */
const KEY_ID_DOMAIN = 'venueos:key-id:v1\n';
function keyIdOf(secret) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('no key to name');
  return crypto.createHash('sha256').update(KEY_ID_DOMAIN).update(secret).digest('hex').slice(0, 16);
}

/** `JSON.stringify` writes `"mintKeyId":"<id>"` with no spaces — what the scan looks for. */
function mintKeyNeedle(keyId) {
  if (!/^[0-9a-f]{16}$/.test(keyId)) throw new Error('not a key id');
  return `"mintKeyId":"${keyId}"`;
}

/**
 * `finish [--override-unrenewed "<reason>"]`. Unknown flags are an error, so a
 * typo can never silently skip the guard.
 */
function parseFinishArgs(argv) {
  const out = { overrideReason: null, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--override-unrenewed') {
      out.errors.push(`unknown argument: ${arg}`);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out.errors.push(`${arg} needs a value`);
      continue;
    }
    i += 1;
    if (value.trim().length < 10) out.errors.push(`${arg} needs a real reason (at least 10 characters)`);
    else out.overrideReason = value.trim();
  }
  return out;
}

/**
 * A libpq URL for running queries from the operator's machine. The Railway
 * value carries container-only TLS file paths and Prisma pool parameters, so
 * every parameter is dropped and replaced with full verification against the
 * CA pinned in the repo — the same posture as install-homebuilder-templates.cjs.
 */
function localDatabaseUrl(rawUrl, { caPath = DEFAULT_CA_PATH, caExists } = {}) {
  if (!rawUrl) throw new Error('DATABASE_URL is not set on the Railway service; cannot check the fleet');
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL is not a URL; cannot check the fleet');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('DATABASE_URL is not a postgres URL');
  const haveCa = typeof caExists === 'function' ? caExists(caPath) : require('node:fs').existsSync(caPath);
  if (!haveCa) throw new Error(`the database CA is missing (${caPath}); refusing to connect without verifying the server`);
  url.search = '';
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', caPath);
  return url.toString();
}

/**
 * Paired, non-revoked screens alive since `activeSince` that were NOT issued a
 * token on the key named `keyId` (in the audit rows since `issuedSince`).
 *
 * The audit side is ONE pass (no per-screen probe: a busy tenant's audit log
 * is large). Every timestamp column is Prisma's `TIMESTAMP(3)` WITHOUT time
 * zone holding UTC, so bound instants are converted to naive UTC on the
 * server and the one timestamp read back is re-labelled as UTC — neither the
 * session TimeZone nor the operator's clock zone can move a boundary.
 */
function pendingScreensQuery({ keyId, activeSince, issuedSince }) {
  return {
    text: `
      WITH issued_on_new_key AS (
        SELECT DISTINCT a.target_id
          FROM audit_logs a
         WHERE a.action = ANY($3::text[])
           AND a.created_at >= ($2::timestamptz AT TIME ZONE 'UTC')
           AND strpos(a.details, $4) > 0
           AND a.target_id IS NOT NULL
      )
      SELECT s.id, s.name, s.tenant_id,
             (GREATEST(s.last_ping_at, s.player_version_at, s.manager_version_at) AT TIME ZONE 'UTC') AS last_seen_at,
             s.player_version, s.auth_state
        FROM screens s
       WHERE s.tenant_id IS NOT NULL
         AND s.status <> 'REVOKED'
         AND GREATEST(s.last_ping_at, s.player_version_at, s.manager_version_at) >= ($1::timestamptz AT TIME ZONE 'UTC')
         AND NOT EXISTS (SELECT 1 FROM issued_on_new_key i WHERE i.target_id = s.id)
       ORDER BY last_seen_at DESC, s.id`,
    values: [activeSince.toISOString(), issuedSince.toISOString(), [...TOKEN_ISSUE_ACTIONS], mintKeyNeedle(keyId)],
  };
}

/** Read-only: the screens that would lose their sign-in if the window closed now. */
async function findUnrenewedScreens(client, { keyId, now }) {
  const activeSince = new Date(now.getTime() - ACTIVE_WITHIN_MS);
  const issuedSince = new Date(now.getTime() - ISSUE_LOOKBACK_MS);
  const { rows } = await client.query(pendingScreensQuery({ keyId, activeSince, issuedSince }));
  return rows;
}

/**
 * The decision table. `pending` is null when the fleet could not be checked.
 * Only an explicit override proceeds past a refusal.
 */
function decideFinish({ pending, overrideReason }) {
  const blocked = pending === null || pending.length > 0;
  if (!blocked) return { proceed: true, override: false };
  if (overrideReason) return { proceed: true, override: true };
  return { proceed: false, override: false };
}

/** Operator-facing lines for the terminal. Ids for the dashboard; capped. */
function describeUnrenewed(rows, now, limit = 40) {
  const lines = rows.slice(0, limit).map((r) => {
    const seen = r.last_seen_at ? new Date(r.last_seen_at) : null;
    const ago = seen ? `${Math.max(0, Math.round((now.getTime() - seen.getTime()) / 60000))} min ago` : 'never';
    const ver = r.player_version ? `player ${r.player_version}` : 'player ?';
    return `  - ${r.id}  ${JSON.stringify(r.name ?? '')}  last seen ${ago}, ${ver}${r.auth_state ? `, ${r.auth_state}` : ''}`;
  });
  if (rows.length > limit) lines.push(`  …and ${rows.length - limit} more`);
  return lines;
}

/**
 * Record the override in the immutable audit log, in one transaction. Throws
 * on any failure — the caller must then remove nothing.
 */
async function recordFinishOverride(client, { id, reason, keyId, pending, operator, now }) {
  const details = {
    secret: 'DEVICE_JWT_SECRET',
    reason,
    newKeyId: keyId || null,
    unrenewedScreenCount: pending ? pending.length : null,
    unrenewedScreenIds: pending ? pending.slice(0, 100).map((r) => r.id) : null,
    operator: operator || null,
    via: 'scripts/railway-rotation.mjs finish --override-unrenewed',
    at: now.toISOString(),
  };
  await client.query('BEGIN');
  try {
    await client.query(
      'INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME, SYSTEM_TENANT_SLUG],
    );
    await client.query(
      `INSERT INTO audit_logs (id, tenant_id, user_id, action, target_type, target_id, details, created_at)
       VALUES ($1, $2, NULL, $3, 'KeyRotation', 'DEVICE_JWT_SECRET', $4, (NOW() AT TIME ZONE 'UTC'))`,
      [id, SYSTEM_TENANT_ID, OVERRIDE_AUDIT_ACTION, JSON.stringify(details)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  return details;
}

/**
 * The whole `finish` gate for the DEVICE_JWT_SECRET window, dependencies
 * injected (railway-rotation.mjs passes the real ones). Resolves true when the
 * window may close; false when it must not (nothing removed). Throws — also
 * "nothing removed" — when the database cannot be reached at all, because the
 * override could not be recorded either.
 *
 *   vars            the Railway variables (`railway variables --json`)
 *   overrideReason  from `--override-unrenewed`, or null
 *   connect         async (connectionString) => client with query()/end()
 */
async function runFinishGuard({ vars, overrideReason, connect, now = new Date(), log = console.log, newId, operator = null, caExists }) {
  if (!vars.DEVICE_JWT_SECRET_PREVIOUS) return true; // no screen-token window open: nothing to prove
  if (!vars.DEVICE_JWT_SECRET) throw new Error('DEVICE_JWT_SECRET is not set; not touching anything');
  const keyId = keyIdOf(vars.DEVICE_JWT_SECRET);
  log(`DEVICE_JWT_SECRET: checking that every screen alive in the last 24 h holds a token on the new key (key id ${keyId}) …`);
  const client = await connect(localDatabaseUrl(vars.DATABASE_URL, { caExists }));
  try {
    let pending = null;
    try {
      pending = await findUnrenewedScreens(client, { keyId, now });
    } catch (e) {
      log(`  could NOT check the fleet: ${e && e.message ? e.message : e}`);
    }
    if (pending && pending.length === 0) {
      log('  every screen alive in the last 24 h has been issued a token on the new key.');
      return true;
    }
    if (pending) {
      log(`  ${pending.length} screen(s) alive in the last 24 h still hold a token signed by the OLD key.`);
      log('  Closing the window now signs them out (they come back on a 1-hour credential and show "re-pair required"):');
      for (const line of describeUnrenewed(pending, now)) log(line);
    }
    const decision = decideFinish({ pending, overrideReason });
    if (!decision.proceed) {
      log([
        '',
        'Nothing removed. While the window is still open, make each listed screen re-register:',
        '  Screens → open the screen → "Resync content" (it reloads, presents its old-key token,',
        '  which the window still accepts, and is issued a 180-day token on the new key).',
        '  A screen that is switched off has to be powered on first. Then run "finish" again.',
        'To close the window anyway: finish --override-unrenewed "<why>" — recorded in the audit',
        'log first. Afterwards use "Restore trust" on each listed screen once it shows "re-pair required".',
      ].join('\n'));
      return false;
    }
    const details = await recordFinishOverride(client, { id: newId(), reason: overrideReason, keyId, pending, operator, now });
    log(
      `OVERRIDE recorded in audit_logs (${OVERRIDE_AUDIT_ACTION}, system tenant): closing the window with ` +
        `${details.unrenewedScreenCount ?? 'an unknown number of'} screen(s) still on the old key. Reason: ${details.reason}`,
    );
    return true;
  } finally {
    await Promise.resolve(client.end()).catch(() => {});
  }
}

module.exports = {
  TOKEN_ISSUE_ACTIONS,
  ACTIVE_WITHIN_MS,
  ISSUE_LOOKBACK_MS,
  OVERRIDE_AUDIT_ACTION,
  SYSTEM_TENANT_ID,
  DEFAULT_CA_PATH,
  KEY_ID_DOMAIN,
  keyIdOf,
  mintKeyNeedle,
  parseFinishArgs,
  localDatabaseUrl,
  pendingScreensQuery,
  findUnrenewedScreens,
  decideFinish,
  describeUnrenewed,
  recordFinishOverride,
  runFinishGuard,
};
