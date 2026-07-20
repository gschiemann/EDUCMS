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

  describe('TRUTH-001 — public-surface claim scan (2026-07-20)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const gate = require('../../../../scripts/check-capability-registry.cjs');

    it('the LIVE marketing + signup surfaces carry no unbacked feature claims', () => {
      const problems = gate.scanPublicClaims(CAPABILITY_REGISTRY, CLAIMABLE_STATES);
      expect(problems).toEqual([]);
    });

    it('a claim on an unbuilt capability (SAML) would FAIL the gate', () => {
      const problems = gate.scanPublicClaims(CAPABILITY_REGISTRY, CLAIMABLE_STATES, [
        { file: 'fixture.tsx', text: 'Enterprise SAML single sign-on, included on every plan!' },
      ]);
      expect(problems.some((p: string) => /SAML/.test(p) && /not customer-claimable/.test(p))).toBe(true);
    });

    it('a claim with NO registered capability (IPAWS / uptime SLA) would FAIL as unregistered', () => {
      const problems = gate.scanPublicClaims(CAPABILITY_REGISTRY, CLAIMABLE_STATES, [
        { file: 'fixture.tsx', text: 'Receives IPAWS national alerts with a 99.99% uptime guarantee.' },
      ]);
      expect(problems.some((p: string) => /IPAWS/.test(p) && /not registered/.test(p))).toBe(true);
      expect(problems.some((p: string) => /uptime/.test(p) && /not registered/.test(p))).toBe(true);
    });

    it('backed claims (SSO / free trial / per-screen pricing / Clever) pass', () => {
      const problems = gate.scanPublicClaims(CAPABILITY_REGISTRY, CLAIMABLE_STATES, [
        {
          file: 'fixture.tsx',
          text: 'SSO sign-in, Clever rostering, free trial, no credit card — $25 per screen per month.',
        },
      ]);
      expect(problems).toEqual([]);
    });
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
