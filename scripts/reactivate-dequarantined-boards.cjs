#!/usr/bin/env node
/*
 * One-time, targeted re-activation of system-preset boards that were REMOVED
 * from the quarantine denylist (packages/api-types/src/quarantine.ts) after
 * being verified as genuinely fixed.
 *
 * WHY THIS SCRIPT EXISTS: the seeder's quarantine pass
 * (apps/api/src/templates/ensure-system-presets.ts) is a ONE-WAY RATCHET — it
 * flips ACTIVE→ARCHIVED for denylisted boards but NEVER re-activates a board
 * removed from the denylist. So an existing prod row stays ARCHIVED forever
 * unless flipped explicitly. A blanket "re-activate every non-quarantined
 * archived system preset" pass is UNSAFE (87 system presets are archived for
 * OTHER reasons — duplicate-name cleanup, portrait denylist, replaced church
 * costumes, sandbox tests, legacy dupes — measured 2026-07-23). So this flips
 * ONLY the explicit, verified ids below and nothing else.
 *
 * SAFE + REVERSIBLE: guarded to isSystem + currently-ARCHIVED, writes a
 * TEMPLATE_UNQUARANTINED audit row per board (system tenant), idempotent
 * (re-running after a row is ACTIVE is a no-op). To reverse, re-add the URL to
 * the denylist and let the next boot's quarantine pass re-archive it, or run
 * an UPDATE ... SET status='ARCHIVED'.
 *
 * RUN ORDER: deploy the quarantine.ts denylist removal FIRST (so the next boot
 * won't re-archive these), THEN run this. Reads DATABASE_URL from apps/api/.env.
 *
 * Usage:
 *   node scripts/reactivate-dequarantined-boards.cjs           # DRY RUN
 *   node scripts/reactivate-dequarantined-boards.cjs --apply    # flip to ACTIVE
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  for (const p of [path.resolve(__dirname, '../apps/api/.env'), path.resolve(__dirname, '../.env')]) {
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
        if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ''); break; }
      }
    }
    if (process.env.DATABASE_URL) break;
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2); }

// Verified de-quarantined boards (adversarial review 2026-07-23,
// docs/research/2026-07-23-fashion-quarantine-verify/). Add ids here ONLY
// after removing the matching URL from quarantine.ts AND verifying the board.
const REACTIVATE = [
  { id: 'preset-sig-fashion-02', name: 'Fashion · Editorial' },
  { id: 'preset-sig-fashion-05', name: 'Fashion · Event' },
];
const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';
const APPLY = process.argv.includes('--apply');

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const ids = REACTIVATE.map((r) => r.id);
    const { rows } = await c.query(
      `SELECT id, name, status FROM templates WHERE id = ANY($1::text[]) AND is_system=true ORDER BY id`,
      [ids],
    );
    console.log('Current state:');
    for (const r of rows) console.log(`  ${r.id}  |  ${r.name}  |  ${r.status}`);
    const toFlip = rows.filter((r) => r.status === 'ARCHIVED');
    console.log(`\n${toFlip.length} board(s) ARCHIVED → would flip to ACTIVE.`);
    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return; }

    let n = 0;
    for (const r of toFlip) {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, target_type, target_id, details, created_at)
           VALUES (gen_random_uuid()::text, $1, NULL, 'TEMPLATE_UNQUARANTINED', 'Template', $2, $3, now())`,
          [SYSTEM_TENANT, r.id, JSON.stringify({ name: r.name, via: 'reactivate-dequarantined-boards.cjs', reason: 'W0-08 dimension-placeholder cleared by redesign f4eee79c; verified 2026-07-23' })],
        );
        await c.query(`UPDATE templates SET status='ACTIVE' WHERE id=$1 AND is_system=true AND status='ARCHIVED'`, [r.id]);
        await c.query('COMMIT');
        n++;
        console.log(`  ✓ ${r.id} → ACTIVE`);
      } catch (e) {
        await c.query('ROLLBACK');
        console.error(`  ! skipped ${r.id}: ${e.message}`);
      }
    }
    console.log(`\nRe-activated ${n}/${toFlip.length}.`);
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
