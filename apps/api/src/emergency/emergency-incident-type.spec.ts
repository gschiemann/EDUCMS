import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * LIFE-SAFETY REGRESSION GUARD — the incident TYPE must survive a tenant-scope
 * emergency trigger all the way to the screen manifest.
 *
 * The 2026-07-25 audit found that a tenant-wide trigger wrote only the SEVERITY
 * into `Tenant.emergencyStatus`. `Severity` ('LOW'|'MODERATE'|'HIGH'|'CRITICAL')
 * and `OverrideIncidentType` ('lockdown'|'evacuate'|...) are DISJOINT enums, so
 * the incident type could not survive — the manifest fell back to the severity
 * and every screen rendered "CRITICAL PROTOCOL ACTIVE" instead of LOCKDOWN or
 * EVACUATE. Those are OPPOSITE actions (hide vs. leave the building), so the
 * boards instructed occupants to do neither. It was live on real tenants.
 *
 * These are source-level asserts on purpose: the bug was three separate silent
 * omissions (never written, not selected, not preferred), each of which
 * individually reduces the fix to a no-op while every existing test stays green.
 */
describe('emergency incident type survives a tenant-scope trigger', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const emergency = read('emergency/emergency.controller.ts');
  const screens = read('screens/screens.controller.ts');
  // 2026-11-01 — the manifest's tenant read (its select, the cache, the
  // district walk) moved to one module shared with the emergency-rev raise
  // confirmation. The select guard follows it there.
  const tenantState = read('screens/tenant-emergency-state.ts');
  const schema = readFileSync(
    join(__dirname, '../../../../packages/database/prisma/schema.prisma'),
    'utf8',
  );

  it('Tenant has a column to store the incident type at all', () => {
    // Without this column the type has nowhere to live and the bug is structural.
    expect(schema).toMatch(/emergencyType\s+String\?\s+@map\("emergency_type"\)/);
  });

  it('the trigger WRITES the incident type, not just the severity', () => {
    // Guards the original defect: `emergencyStatus: severity` with no type write.
    expect(emergency).toMatch(/emergencyType:\s*overridePayload\.type/);
  });

  it('all-clear CLEARS the incident type', () => {
    // A stale type would leave a cleared tenant looking mid-incident.
    const idx = emergency.indexOf("emergencyStatus: 'INACTIVE'");
    expect(idx).toBeGreaterThan(-1);
    expect(emergency.slice(idx, idx + 400)).toMatch(/emergencyType:\s*null/);
  });

  it('the manifest SELECTS the column (or the read is silently undefined)', () => {
    // The manifest uses an explicit Prisma `select`; omitting the field makes
    // tenant.emergencyType undefined and the fix a no-op with no error anywhere.
    const idx = tenantState.indexOf('emergencyStatus: true');
    expect(idx).toBeGreaterThan(-1);
    expect(tenantState.slice(idx, idx + 400)).toMatch(/emergencyType:\s*true/);
    // …and that select IS the manifest's: the manifest reads its tenant
    // through the shared module, not through a select of its own.
    expect(screens).toMatch(/await resolveTenantEmergencyState\(/);
    expect(screens).not.toMatch(/MANIFEST_TENANT_EMERGENCY_SELECT = \{/);
  });

  it('the manifest PREFERS the incident type over the severity', () => {
    // Order matters: per-screen override → tenant incident type → legacy status.
    const m = screens.match(/const effectiveType\s*=([\s\S]{0,400}?);/);
    expect(m).toBeTruthy();
    const expr = m![1];
    const typeIdx = expr.indexOf('emergencyType');
    const statusIdx = expr.indexOf('emergencyStatus');
    expect(typeIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(-1);
    expect(typeIdx).toBeLessThan(statusIdx);
  });
});
