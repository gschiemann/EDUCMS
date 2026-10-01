#!/usr/bin/env node
// Scoped, additive intake. Never rewrites an existing customer template.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const dotenv = require('dotenv');
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const tenantId = option('--tenant-id');
const expectedName = option('--expected-tenant-name');
const operatorId = option('--operator-id');
const apply = args.includes('--apply');
if (!args.includes('--tenant-id') || !args.includes('--expected-tenant-name') || !args.includes('--operator-id')) {
  throw new Error('Required: --tenant-id ID --expected-tenant-name NAME --operator-id ID [--env-file PATH] [--apply]');
}
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/templates/homebuilder-install-manifest.json'), 'utf8'));
if (manifest.length !== 28 || manifest.filter((r) => r.collection === 'standard').length !== 14) throw new Error('Incomplete manifest');
for (const record of manifest) {
  const file = path.join(root, 'apps/web/public', record.url);
  if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== record.sha256) throw new Error(`HTML digest mismatch: ${record.id}`);
}
const env = args.includes('--env-file') ? dotenv.parse(fs.readFileSync(option('--env-file'))) : process.env;
const connection = new URL(env.DATABASE_URL);
const certificate = args.includes('--ssl-ca') ? option('--ssl-ca') : path.join(root, 'packages/database/certs/supabase-prod-ca-2021.crt');
if (fs.existsSync(certificate)) {
  connection.searchParams.set('sslmode', 'verify-full');
  connection.searchParams.set('sslrootcert', certificate);
}
const client = new Client({ connectionString: connection.href });
(async () => {
  await client.connect();
  try {
    const tenant = (await client.query('SELECT id,name,vertical,archived_at FROM tenants WHERE id=$1', [tenantId])).rows[0];
    if (!tenant || tenant.name !== expectedName || tenant.vertical !== 'CORPORATE' || tenant.archived_at) throw new Error('Target tenant does not match the approved Corporate account');
    const operator = (await client.query('SELECT id,role FROM users WHERE id=$1', [operatorId])).rows[0];
    if (operator?.role !== 'SUPER_ADMIN') throw new Error('Installer requires an existing super-admin operator');
    await client.query('BEGIN');
    const summary = [];
    for (const record of manifest) {
      const system = record.collection === 'standard';
      const existing = (await client.query('SELECT id,tenant_id,is_system FROM templates WHERE id=$1 FOR UPDATE', [record.id])).rows[0];
      if (existing && (existing.is_system !== system || existing.tenant_id !== (system ? null : tenantId))) throw new Error(`Ownership collision: ${record.id}`);
      if (!existing && apply) {
        await client.query(`INSERT INTO templates (id,tenant_id,name,description,category,orientation,school_level,vertical,screen_width,screen_height,is_system,status,bg_color,created_by_id,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'UNIVERSAL','CORPORATE',$7,$8,$9,'ACTIVE',$10,$11,NOW(),NOW())`,
        [record.id, system ? null : tenantId, record.name, record.description, record.category, record.orientation, record.screenWidth, record.screenHeight, system, record.bgColor, system ? null : operatorId]);
        const sceneId = randomUUID();
        await client.query('INSERT INTO template_scenes (id,template_id,name,sort_order,is_default,created_at) VALUES ($1,$2,\'Default\',0,true,NOW())', [sceneId, record.id]);
        await client.query(`INSERT INTO template_zones (id,template_id,scene_id,name,widget_type,x,y,width,height,z_index,sort_order,default_config,locked)
          VALUES ($1,$2,$3,'Scene','EXTERNAL_HTML',0,0,100,100,1,0,$4,false)`, [randomUUID(), record.id, sceneId, JSON.stringify({ url: record.url })]);
      }
      // Audit the operator's installation, including rows seeded by the API.
      if (apply) await client.query(`INSERT INTO audit_logs (id,tenant_id,user_id,action,target_type,target_id,details,created_at)
        VALUES ($1,$2,$3,'TEMPLATE_PACK_INSTALLED','Template',$4,$5,NOW())`, [randomUUID(), tenantId, operatorId, record.id, JSON.stringify({ pack: 'homebuilder-2026-09-30', collection: record.collection, sha256: record.sha256, scope: system ? 'Corporate system preset' : 'Brookfield tenant custom', created: !existing, performedBy: 'Codex at operator request', intervalSeconds: 7 })]);
      summary.push({ id: record.id, scope: system ? 'Corporate standard' : 'Brookfield custom', result: existing ? 'preserved' : apply ? 'created' : 'would create' });
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ applied: apply, tenant: tenant.name, templates: summary }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
