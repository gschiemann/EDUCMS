#!/usr/bin/env node
/*
 * One-time, REVERSIBLE cleanup: archive every tenant EXCEPT the real-customer
 * keep-list, so the owner console / switcher / fleet map show only real
 * accounts + Springfield. Archive is soft-delete (sets archived_at) — nothing
 * is destroyed; `--restore <id>` or POST /tenants/:id/unarchive brings any
 * back. Mirrors the archive endpoint: writes a TENANT_ARCHIVED audit row per
 * tenant in the same transaction (compliance).
 *
 * PREREQUISITE: the archived_at column must exist in the target DB — deploy the
 * 20260723140000_tenant_archived_at migration first.
 *
 * Usage:
 *   node scripts/archive-test-tenants.cjs            # DRY RUN — prints the plan, writes nothing
 *   node scripts/archive-test-tenants.cjs --apply    # archive the non-keep tenants
 *   node scripts/archive-test-tenants.cjs --restore <tenantId>   # unarchive one
 *
 * Reads DATABASE_URL from the environment / apps/api/.env.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load DATABASE_URL from apps/api/.env if not already set.
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

// Real customers + Springfield + system — NEVER archived. Reviewed 2026-07-23
// (docs/research/2026-07-23-tenant-cleanup/00-PLAN.md). AGC Education + ARC
// Service Department kept out of caution (real-sounding, have users) — archive
// later by hand if Greg confirms they're test.
const KEEP = new Set([
  '00000000-0000-0000-0000-000000000000', // System (security events)
  '00000000-0000-0000-0000-000000000001', // Springfield School District
  '00000000-0000-0000-0000-000000000002', // Springfield Elementary
  '28d09f9d-0a6c-4828-b46d-38712eb69f1f', // Dodgers
  '81554fbe-ba69-4cea-ae6d-49c11ee15133', // VisionCore Systems
  '88118f06-dd2b-4d6e-8ad9-c199595d1201', // Goodview
  '2bf88a7b-bc73-4724-95df-fdd71df8e4f2', // Chardon High School
  '03e6cecb-a724-4e17-85ad-19709b60b3ea', // Chardon Middle School
  '13d421aa-0d1f-4bca-9bcf-7f2c7ac5b6a5', // Fremont Elementary
  'e1ce74a1-4f16-4e87-941e-d00d230a3f50', // AGC Education (keep — maybe real)
  '7976439f-542b-47ec-b740-5dfaad24081e', // ARC Service Department (keep — maybe real)
]);

const APPLY = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE_ID = restoreIdx >= 0 ? process.argv[restoreIdx + 1] : null;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // guard: column must exist
    const col = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='archived_at'`);
    if (!col.rowCount) { console.error('archived_at column missing — deploy the migration first.'); process.exit(3); }

    if (RESTORE_ID) {
      const r = await c.query(`UPDATE tenants SET archived_at=NULL WHERE id=$1 RETURNING name`, [RESTORE_ID]);
      console.log(r.rowCount ? `Restored: ${r.rows[0].name} (${RESTORE_ID})` : `No tenant ${RESTORE_ID}`);
      return;
    }

    const keepArr = [...KEEP];
    const { rows: targets } = await c.query(
      `SELECT id, name, parent_id FROM tenants WHERE archived_at IS NULL AND id <> ALL($1::text[]) ORDER BY name`,
      [keepArr],
    );
    const { rows: kept } = await c.query(
      `SELECT name FROM tenants WHERE id = ANY($1::text[]) ORDER BY name`, [keepArr],
    );
    console.log(`KEEP (${kept.length}): ${kept.map((k) => k.name).join(', ')}`);
    console.log(`\nWOULD ARCHIVE (${targets.length}):`);
    for (const t of targets) console.log(`  - ${t.name}  ${t.id}`);

    if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --apply to archive.`); return; }

    let n = 0;
    for (const t of targets) {
      await c.query('BEGIN');
      try {
        await c.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, target_type, target_id, details, created_at)
           VALUES (gen_random_uuid()::text, $1, NULL, 'TENANT_ARCHIVED', 'Tenant', $2, $3, now())`,
          [t.parent_id || t.id, t.id, JSON.stringify({ name: t.name, via: 'archive-test-tenants.cjs' })],
        );
        await c.query(`UPDATE tenants SET archived_at=now() WHERE id=$1`, [t.id]);
        await c.query('COMMIT');
        n++;
      } catch (e) {
        await c.query('ROLLBACK');
        console.error(`  ! skipped ${t.name} (${t.id}): ${e.message}`);
      }
    }
    console.log(`\nArchived ${n}/${targets.length}. Reversible via --restore <id> or POST /tenants/:id/unarchive.`);
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
