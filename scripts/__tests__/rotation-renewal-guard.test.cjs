const { test } = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../rotation-renewal-guard.cjs');

const NOW = new Date('2026-10-23T06:00:00.000Z');
const KEY_ID = 'd094971bcaf317f5';

test('keyIdOf matches the API (apps/api/src/security/key-ring.spec.ts pins the same vector)', () => {
  assert.equal(guard.keyIdOf('example-device-jwt-secret-0123456789abcdef'), KEY_ID);
  assert.equal(guard.keyIdOf('another-example-secret-fedcba9876543210'), 'efbe3125fcfffd72');
  assert.throws(() => guard.keyIdOf(''), /no key/);
  assert.throws(() => guard.keyIdOf(undefined), /no key/);
});

test('the needle is exactly what JSON.stringify writes into the audit details', () => {
  const details = JSON.stringify({ priorTokenStatus: 'valid', mintKeyId: KEY_ID, ip: '10.0.0.1' });
  assert.ok(details.includes(guard.mintKeyNeedle(KEY_ID)));
  assert.throws(() => guard.mintKeyNeedle("x' OR 1=1 --"), /not a key id/);
});

test('finish arguments: only a reasoned override; anything else is refused', () => {
  assert.deepEqual(guard.parseFinishArgs([]), { overrideReason: null, errors: [] });
  const ok = guard.parseFinishArgs(['--override-unrenewed', 'two screens are in storage for the summer']);
  assert.equal(ok.overrideReason, 'two screens are in storage for the summer');
  assert.deepEqual(ok.errors, []);
  // A typo must never silently skip the guard.
  assert.match(guard.parseFinishArgs(['--overide-unrenewed', 'two screens are in storage']).errors.join(), /unknown argument/);
  assert.match(guard.parseFinishArgs(['--override-unrenewed']).errors.join(), /needs a value/);
  assert.match(guard.parseFinishArgs(['--override-unrenewed', '--force']).errors.join(), /needs a value/);
  assert.match(guard.parseFinishArgs(['--override-unrenewed', 'yes']).errors.join(), /real reason/);
});

test('the local database URL drops every container-only parameter and verifies the server against the pinned CA', () => {
  const railway = 'postgresql://postgres.ref:secretpw@pooler.example.test:5432/postgres?sslmode=require&sslcert=/app/certs/client.crt&sslrootcert=/app/certs/ca.crt&connection_limit=10&pool_timeout=20';
  const out = new URL(guard.localDatabaseUrl(railway, { caPath: '/repo/ca.crt', caExists: () => true }));
  assert.equal(out.hostname, 'pooler.example.test');
  assert.equal(out.password, 'secretpw');
  assert.deepEqual([...out.searchParams.keys()].sort(), ['sslmode', 'sslrootcert']);
  assert.equal(out.searchParams.get('sslmode'), 'verify-full');
  assert.equal(out.searchParams.get('sslrootcert'), '/repo/ca.crt');
  // No CA, no connection — never an unverified TLS session to production.
  assert.throws(() => guard.localDatabaseUrl(railway, { caPath: '/nope', caExists: () => false }), /CA is missing/);
  assert.throws(() => guard.localDatabaseUrl('', {}), /not set/);
  assert.throws(() => guard.localDatabaseUrl('https://example.test/db', { caExists: () => true }), /not a postgres URL/);
  // The pinned CA really is in the repo.
  assert.ok(require('node:fs').existsSync(guard.DEFAULT_CA_PATH));
});

test('the query: alive in the last 24 h, paired, not revoked, and NO token issued on the new key', () => {
  const activeSince = new Date(NOW.getTime() - guard.ACTIVE_WITHIN_MS);
  const issuedSince = new Date(NOW.getTime() - guard.ISSUE_LOOKBACK_MS);
  const q = guard.pendingScreensQuery({ keyId: KEY_ID, activeSince, issuedSince });
  assert.deepEqual(q.values, [
    '2026-10-22T06:00:00.000Z',
    '2026-09-23T06:00:00.000Z',
    ['SCREEN_TOKEN_RENEWED', 'SCREEN_TOKEN_DOWNGRADED', 'DEVICE_PAIRED'],
    `"mintKeyId":"${KEY_ID}"`,
  ]);
  const sql = q.text.replace(/\s+/g, ' ');
  assert.match(sql, /s\.tenant_id IS NOT NULL/);
  assert.match(sql, /s\.status <> 'REVOKED'/);
  // A screen whose player is dark but whose Manager still checks in is the one at risk.
  assert.match(sql, /GREATEST\(s\.last_ping_at, s\.player_version_at, s\.manager_version_at\) >= \(\$1::timestamptz AT TIME ZONE 'UTC'\)/);
  // The proof is the KEY, not the time: a row stamped with the new key's id.
  assert.match(sql, /a\.action = ANY\(\$3::text\[\]\) AND a\.created_at >= \(\$2::timestamptz AT TIME ZONE 'UTC'\) AND strpos\(a\.details, \$4\) > 0/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM issued_on_new_key i WHERE i\.target_id = s\.id\)/);
});

test('findUnrenewedScreens asks the client exactly that query, read-only', async () => {
  const calls = [];
  const client = { query: async (q) => { calls.push(q); return { rows: [{ id: 's1' }] }; } };
  const rows = await guard.findUnrenewedScreens(client, { keyId: KEY_ID, now: NOW });
  assert.deepEqual(rows, [{ id: 's1' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^\s*WITH issued_on_new_key AS/);
  assert.doesNotMatch(calls[0].text, /\b(INSERT|UPDATE|DELETE)\b/);
});

test('the decision table: only an explicit override goes past a refusal', () => {
  assert.deepEqual(guard.decideFinish({ pending: [], overrideReason: null }), { proceed: true, override: false });
  assert.deepEqual(guard.decideFinish({ pending: [{ id: 's1' }], overrideReason: null }), { proceed: false, override: false });
  assert.deepEqual(guard.decideFinish({ pending: [{ id: 's1' }], overrideReason: 'accepting the cost' }), { proceed: true, override: true });
  // The fleet could not be checked at all — also a refusal.
  assert.deepEqual(guard.decideFinish({ pending: null, overrideReason: null }), { proceed: false, override: false });
  assert.deepEqual(guard.decideFinish({ pending: null, overrideReason: 'accepting the cost' }), { proceed: true, override: true });
  // A fleet that is all on the new key never needs (or records) an override.
  assert.deepEqual(guard.decideFinish({ pending: [], overrideReason: 'accepting the cost' }), { proceed: true, override: false });
});

test('the operator sees ids, how long ago, and the player version — capped', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: `screen-${i}`, name: `Lobby ${i}`, last_seen_at: new Date(NOW.getTime() - 15 * 60000), player_version: '1.1.23', auth_state: 'PROVEN',
  }));
  const lines = guard.describeUnrenewed(rows, NOW);
  assert.equal(lines.length, 41);
  assert.match(lines[0], /screen-0 {2}"Lobby 0" {2}last seen 15 min ago, player 1\.1\.23, PROVEN/);
  assert.match(lines[40], /and 5 more/);
});

test('an override is recorded in the audit log in one transaction BEFORE anything is removed', async () => {
  const calls = [];
  const client = { query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } };
  const details = await guard.recordFinishOverride(client, {
    id: 'audit-1', reason: 'two screens are in storage', keyId: KEY_ID, pending: [{ id: 's1' }, { id: 's2' }], operator: 'ops', now: NOW,
  });
  assert.deepEqual(calls.map((c) => c.text.split(/\s+/).slice(0, 3).join(' ')), ['BEGIN', 'INSERT INTO tenants', 'INSERT INTO audit_logs', 'COMMIT']);
  const audit = calls[2];
  assert.equal(audit.values[0], 'audit-1');
  assert.equal(audit.values[1], guard.SYSTEM_TENANT_ID);
  assert.equal(audit.values[2], guard.OVERRIDE_AUDIT_ACTION);
  assert.deepEqual(JSON.parse(audit.values[3]), details);
  assert.equal(details.reason, 'two screens are in storage');
  assert.equal(details.newKeyId, KEY_ID);
  assert.equal(details.unrenewedScreenCount, 2);
  assert.deepEqual(details.unrenewedScreenIds, ['s1', 's2']);
  // Never the key itself.
  assert.doesNotMatch(audit.values[3], /example-device-jwt-secret/);
});

// ── runFinishGuard: the whole gate, with a fake database ────────────────────
const NEW_SECRET = 'example-device-jwt-secret-0123456789abcdef';
const windowOpen = {
  DEVICE_JWT_SECRET: NEW_SECRET,
  DEVICE_JWT_SECRET_PREVIOUS: 'the-old-key-that-is-retiring-0123456789',
  DATABASE_URL: 'postgresql://u:p@db.example.test:5432/postgres?sslcert=/app/x.crt',
};
function fakeDb({ pendingRows = [], failSelect = false, failAudit = false } = {}) {
  const calls = [];
  const state = { connectedWith: null, ended: false, calls };
  const connect = async (cs) => {
    state.connectedWith = cs;
    return {
      query: async (q, values) => {
        const text = typeof q === 'string' ? q : q.text;
        calls.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        if (/issued_on_new_key/.test(text)) {
          if (failSelect) throw new Error('permission denied for table screens');
          assert.equal(q.values[3], `"mintKeyId":"${KEY_ID}"`); // the NEW key's id, computed locally
          return { rows: pendingRows };
        }
        if (failAudit && /INSERT INTO audit_logs/.test(text)) throw new Error('audit write refused');
        return { rows: [], values };
      },
      end: async () => { state.ended = true; },
    };
  };
  return { connect, state };
}
const quiet = () => {};
const run = (overrides) => guard.runFinishGuard({
  vars: windowOpen, overrideReason: null, now: NOW, log: quiet, newId: () => 'audit-x', operator: 'ops', caExists: () => true, ...overrides,
});

test('runFinishGuard: no DEVICE_JWT_SECRET window open → nothing to prove, no database touched', async () => {
  const db = fakeDb();
  assert.equal(await run({ vars: { DEVICE_JWT_SECRET: NEW_SECRET }, connect: db.connect }), true);
  assert.equal(db.state.connectedWith, null);
});

test('runFinishGuard: the whole fleet is on the new key → the window may close, nothing written', async () => {
  const db = fakeDb({ pendingRows: [] });
  assert.equal(await run({ connect: db.connect }), true);
  assert.match(db.state.connectedWith, /sslmode=verify-full/);
  assert.doesNotMatch(db.state.connectedWith, /sslcert=/);
  assert.deepEqual(db.state.calls, ['WITH issued_on_new_key AS']);
  assert.equal(db.state.ended, true);
});

test('runFinishGuard: a live screen still on the old key → REFUSED, nothing written, and the operator is told what to do', async () => {
  const db = fakeDb({ pendingRows: [{ id: 'screen-a', name: 'Lobby', last_seen_at: NOW, player_version: '1.1.23' }] });
  const lines = [];
  assert.equal(await run({ connect: db.connect, log: (l) => lines.push(l) }), false);
  assert.deepEqual(db.state.calls, ['WITH issued_on_new_key AS']);
  const said = lines.join('\n');
  assert.match(said, /1 screen\(s\) alive in the last 24 h still hold a token signed by the OLD key/);
  assert.match(said, /screen-a/);
  assert.match(said, /Resync content/);
  assert.match(said, /--override-unrenewed/);
  assert.doesNotMatch(said, new RegExp(NEW_SECRET)); // the key is never printed
  assert.equal(db.state.ended, true);
});

test('runFinishGuard: with an override, the audit row is written (and committed) before the caller may remove anything', async () => {
  const db = fakeDb({ pendingRows: [{ id: 'screen-a' }, { id: 'screen-b' }] });
  assert.equal(await run({ connect: db.connect, overrideReason: 'two screens are in storage for the summer' }), true);
  assert.deepEqual(db.state.calls, ['WITH issued_on_new_key AS', 'BEGIN', 'INSERT INTO tenants', 'INSERT INTO audit_logs', 'COMMIT']);
});

test('runFinishGuard: an override that cannot be recorded throws — so the caller removes nothing', async () => {
  const db = fakeDb({ pendingRows: [{ id: 'screen-a' }], failAudit: true });
  await assert.rejects(run({ connect: db.connect, overrideReason: 'two screens are in storage for the summer' }), /audit write refused/);
  assert.equal(db.state.ended, true);
});

test('runFinishGuard: a fleet that cannot be checked is refused without an override, and recorded with one', async () => {
  const refused = fakeDb({ failSelect: true });
  assert.equal(await run({ connect: refused.connect }), false);
  const overridden = fakeDb({ failSelect: true });
  assert.equal(await run({ connect: overridden.connect, overrideReason: 'database role cannot read screens today' }), true);
  assert.ok(overridden.state.calls.includes('INSERT INTO audit_logs'));
});

test('runFinishGuard: an unreachable database or a missing CA throws before anything could be removed', async () => {
  await assert.rejects(run({ connect: async () => { throw new Error('ECONNREFUSED'); } }), /ECONNREFUSED/);
  await assert.rejects(run({ connect: fakeDb().connect, caExists: () => false }), /CA is missing/);
  await assert.rejects(run({ connect: fakeDb().connect, vars: { ...windowOpen, DEVICE_JWT_SECRET: '' } }), /DEVICE_JWT_SECRET is not set/);
});

test('a failed override record throws (and rolls back) so the caller removes nothing', async () => {
  const calls = [];
  const client = {
    query: async (text) => {
      calls.push(text);
      if (/INSERT INTO audit_logs/.test(text)) throw new Error('permission denied');
      return { rows: [] };
    },
  };
  await assert.rejects(
    guard.recordFinishOverride(client, { id: 'a', reason: 'some reason here', keyId: KEY_ID, pending: null, operator: null, now: NOW }),
    /permission denied/,
  );
  assert.equal(calls[calls.length - 1], 'ROLLBACK');
});
