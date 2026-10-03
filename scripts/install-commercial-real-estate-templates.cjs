#!/usr/bin/env node
// Additive, tenant-scoped intake; dry-run unless --apply is supplied.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
class IntakeError extends Error {}

function loadManifest() {
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'docs/templates/commercial-real-estate-install-manifest.json'), 'utf8'));
  if (rows.length !== 32 || rows.filter(r => r.collection === 'standard').length !== 16 || rows.filter(r => r.collection === 'jll').length !== 16 || new Set(rows.map(r => r.id)).size !== 32) throw new IntakeError('Incomplete commercial property pack');
  const publicRoot = path.join(root, 'apps/web/public');
  for (const r of rows) {
    const file = path.resolve(publicRoot, '.' + r.url.split('?')[0]);
    if (!file.startsWith(publicRoot + path.sep) || !/^\/(templates\/signage\/corporate\/commercial-real-estate|templates\/kiosk\/commercial-real-estate|templates\/custom\/jll-commercial-real-estate)\//.test(r.url)) throw new IntakeError('Invalid asset path');
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== r.sha256) throw new IntakeError(`HTML digest mismatch: ${r.id}`);
    if (r.vertical !== 'CORPORATE') throw new IntakeError('Invalid preset vertical');
  }
  return rows;
}

async function install(db, rows, options) {
  const { tenantId, expectedName, operatorId, apply = false } = options;
  if (!tenantId || !expectedName || !operatorId) throw new IntakeError('An exact tenant id/name and operator id are required');
  return db.$transaction(async tx => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, vertical: true, archivedAt: true } });
    if (!tenant || tenant.name !== expectedName || tenant.vertical !== 'CORPORATE' || tenant.archivedAt) throw new IntakeError('Target must match the confirmed active Corporate tenant');
    const operator = await tx.user.findUnique({ where: { id: operatorId }, select: { role: true, deletedAt: true } });
    if (!operator || operator.role !== 'SUPER_ADMIN' || operator.deletedAt) throw new IntakeError('An active super-admin operator is required');
    const summary = [];
    for (const r of rows) {
      const system = r.collection === 'standard';
      // Administrative import only: this lookup is immediately ownership checked.
      const existing = await tx.template.findUnique({ where: { id: r.id }, select: { tenantId: true, isSystem: true } });
      if (existing && (existing.isSystem !== system || existing.tenantId !== (system ? null : tenantId))) throw new IntakeError(`Ownership collision: ${r.id}`);
      if (apply && !existing) {
        const { id, name, description, category, orientation, screenWidth, screenHeight, bgColor } = r;
        await tx.template.create({ data: { id, name, description, category, orientation, screenWidth, screenHeight, bgColor,
          tenantId: system ? null : tenantId, createdById: system ? null : operatorId,
          vertical: 'CORPORATE', schoolLevel: 'UNIVERSAL', isSystem: system, status: 'ACTIVE',
          isTouchEnabled: category === 'KIOSK', idleResetMs: 120000,
        } });
        const scene = await tx.templateScene.create({ data: { templateId: id, name: 'Default', sortOrder: 0, isDefault: true } });
        await tx.templateZone.create({ data: { templateId: id, sceneId: scene.id, name: 'Scene', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, locked: false, defaultConfig: JSON.stringify({ url: r.url }) } });
      }
      if (apply) await tx.auditLog.create({ data: { tenantId, userId: operatorId, action: 'TEMPLATE_PACK_INSTALLED', targetType: 'Template', targetId: r.id,
        details: JSON.stringify({ pack: 'commercial-real-estate-2026-10-03', collection: r.collection, sha256: r.sha256, scope: system ? 'Corporate system preset' : 'JLL tenant custom', created: !existing }),
      } });
      summary.push({ id: r.id, scope: system ? 'Corporate standard' : 'JLL tenant custom', result: existing ? 'preserved' : apply ? 'created' : 'would create' });
    }
    return { applied: apply, tenant: tenant.name, templates: summary };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/install-commercial-real-estate-templates.cjs --tenant-id ID --expected-tenant-name NAME --operator-id ID [--env-file PATH] [--apply]\nDefaults to read-only dry run. Deploy and approve the assets before --apply.');
    return;
  }
  const option = name => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
  const options = { tenantId: option('--tenant-id'), expectedName: option('--expected-tenant-name'), operatorId: option('--operator-id'), apply: args.includes('--apply') };
  if (!options.tenantId || !options.expectedName || !options.operatorId) throw new IntakeError('Required: --tenant-id ID --expected-tenant-name NAME --operator-id ID; use --help');
  const env = option('--env-file') ? require('dotenv').parse(fs.readFileSync(option('--env-file'))) : process.env;
  if (!env.DATABASE_URL) throw new IntakeError('DATABASE_URL is required');
  let connection;
  try { connection = new URL(env.DATABASE_URL); } catch { throw new IntakeError('Invalid DATABASE_URL'); }
  const connectionLimit = Number(connection.searchParams.get('connection_limit'));
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || connection.port !== '5432' || connection.searchParams.has('pgbouncer') || !Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 10 || connection.searchParams.get('pool_timeout') !== '20') throw new IntakeError('Use the approved session-mode URL: port 5432, no pgbouncer parameter, connection_limit 1–10 and pool_timeout=20');
  const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.join(root, 'packages/database'), path.join(root, 'apps/api')] }));
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try { console.log(JSON.stringify(await install(db, loadManifest(), options), null, 2)); }
  finally { await db.$disconnect(); }
}
module.exports = { install, loadManifest, IntakeError };
if (require.main === module) main().catch(error => { console.error(error instanceof IntakeError ? error.message : 'Installation failed; no transaction was committed. Check database connectivity and schema.'); process.exitCode = 1; });
