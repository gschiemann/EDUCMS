import * as fs from 'fs';
import * as path from 'path';
import {
  CAPABILITY_REGISTRY,
  CLAIMABLE_STATES,
  EVIDENCE_REQUIRED_STATES,
  type Capability,
} from '@cms/api-types';

/**
 * §21 keystone: the capability registry seed must be HONEST. These asserts
 * mirror the CI gate (scripts/check-capability-registry.cjs) so a dishonest
 * edit fails in the api test suite too — VERIFIED without evidence, or a public
 * claim on an unbuilt feature, can never merge.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('capability registry — §21 truth invariants', () => {
  it('has capabilities and unique ids', () => {
    expect(CAPABILITY_REGISTRY.length).toBeGreaterThan(10);
    const ids = CAPABILITY_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every VERIFIED/PRODUCTION/HARDWARE_CERTIFIED capability has a resolvable evidenceTest file', () => {
    const offenders: string[] = [];
    for (const c of CAPABILITY_REGISTRY) {
      if (!EVIDENCE_REQUIRED_STATES.has(c.state)) continue;
      if (!c.evidenceTest) {
        offenders.push(`${c.id}: no evidenceTest`);
        continue;
      }
      if (!fs.existsSync(path.join(REPO_ROOT, c.evidenceTest))) {
        offenders.push(`${c.id}: evidenceTest missing on disk (${c.evidenceTest})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no capability makes a public claim from a non-claimable state', () => {
    const offenders = CAPABILITY_REGISTRY.filter(
      (c: Capability) => c.publicClaim && !CLAIMABLE_STATES.has(c.state),
    ).map((c) => `${c.id} (${c.state})`);
    expect(offenders).toEqual([]);
  });

  it('SAML is not claimed as shipped (it is removed / NOT_BUILT)', () => {
    const saml = CAPABILITY_REGISTRY.find((c) => c.id === 'saml-sso');
    expect(saml).toBeDefined();
    expect(saml!.state).toBe('NOT_BUILT');
    expect(saml!.publicClaim).toBeNull();
  });

  it('every dependsOn resolves to a known capability id', () => {
    const ids = new Set(CAPABILITY_REGISTRY.map((c) => c.id));
    const bad: string[] = [];
    for (const c of CAPABILITY_REGISTRY) {
      for (const d of c.dependsOn) if (!ids.has(d)) bad.push(`${c.id}→${d}`);
    }
    expect(bad).toEqual([]);
  });
});
