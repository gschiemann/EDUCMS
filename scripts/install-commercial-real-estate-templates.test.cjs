const { test } = require('node:test');
const assert = require('node:assert/strict');
const { install, loadManifest } = require('./install-commercial-real-estate-templates.cjs');
const options = { tenantId: 'tenant-jll', expectedName: 'JLL', operatorId: 'operator' };
function database({ name = 'JLL', archivedAt = null, role = 'SUPER_ADMIN', deletedAt = null, collision = false, auditFails = false } = {}) {
  let committed = [];
  return { get committed() { return committed; }, async $transaction(fn) {
    const pending = [];
    const create = type => async data => { pending.push({ type, ...data }); return { id: 'scene' }; };
    const tx = { tenant: { findUnique: async () => ({ name, vertical: 'CORPORATE', archivedAt }) }, user: { findUnique: async () => ({ role, deletedAt }) },
      template: { findUnique: async ({ where }) => collision && where.id.startsWith('jll-') ? { tenantId: 'other-tenant', isSystem: false } : null, create: create('template') },
      templateScene: { create: create('scene') }, templateZone: { create: create('zone') }, auditLog: { create: async data => { if (auditFails) throw Error('Audit write failed'); return create('audit')(data); } } };
    const result = await fn(tx); committed = pending; return result;
  } };
}
test('manifest digests match the 32 review records', () => assert.equal(loadManifest().length, 32));
test('dry run has no writes', async () => { const db = database(); const r = await install(db, loadManifest(), options); assert.equal(r.applied, false); assert.equal(db.committed.length, 0); });
test('only approved active tenant and operator can install', async () => {
  for (const input of [{ name: 'Other' }, { archivedAt: new Date() }, { role: 'TENANT_ADMIN' }, { deletedAt: new Date() }]) {
    const db = database(input); await assert.rejects(install(db, loadManifest(), { ...options, apply: true })); assert.equal(db.committed.length, 0);
  }
});
test('ownership collision rolls back the entire intake', async () => { const db = database({ collision: true }); await assert.rejects(install(db, loadManifest(), { ...options, apply: true }), /Ownership collision/); assert.equal(db.committed.length, 0); });
test('audit failure prevents committing templates', async () => { const db = database({ auditFails: true }); await assert.rejects(install(db, loadManifest(), { ...options, apply: true }), /Audit write failed/); assert.equal(db.committed.length, 0); });
test('JLL stays tenant scoped; generic presets are system-owned; kiosk flag and scenes are present', async () => {
  const db = database(); await install(db, loadManifest(), { ...options, apply: true });
  const templates = db.committed.filter(r => r.type === 'template').map(r => r.data);
  assert.equal(templates.filter(r => r.isSystem && r.tenantId === null).length, 16);
  assert.equal(templates.filter(r => !r.isSystem && r.tenantId === options.tenantId).length, 16);
  assert.equal(templates.filter(r => r.isTouchEnabled).length, 8);
  for (const type of ['scene', 'zone', 'audit']) assert.equal(db.committed.filter(r => r.type === type).length, 32);
});
