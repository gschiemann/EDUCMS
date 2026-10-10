import { setupLinksCsv, setupLinksCsvFilename } from '../setup-links-csv';
import {
  SETUP_TWO_STEP_HANDOFF_KEY,
  isTwoStepEnvelope,
  stashSetupTwoStep,
  takeSetupTwoStep,
} from '../setup-two-step-handoff';

const H = { location: 'Location', name: 'Name', currentEmail: 'Current sign-in email', role: 'Role', link: 'Setup link', expires: 'Expires' };

describe('setup links CSV', () => {
  it('quotes every cell, keeps UTF-8 with a BOM, and one row per link', () => {
    const csv = setupLinksCsv(
      [{ location: 'RIOT "Tulsa", OK', firstName: null, lastName: null, email: 'riot-tulsa@riotcolor.com', role: 'Location admin', url: 'https://app.test/setup-account/abc', expiresAt: '2026-10-17T12:00:00.000Z' }],
      H,
    );
    expect(csv.startsWith('﻿"Location","Name"')).toBe(true);
    expect(csv).toContain('"RIOT ""Tulsa"", OK","","riot-tulsa@riotcolor.com","Location admin","https://app.test/setup-account/abc","2026-10-17"');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  it('neutralises spreadsheet formulas (CSV injection)', () => {
    const csv = setupLinksCsv([{ location: '=HYPERLINK("http://evil")', firstName: '+1', lastName: null, email: 'a@b.c', role: 'r', url: 'u', expiresAt: '2026-01-01' }], H);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'+1"`);
  });

  it('dated filename', () => {
    expect(setupLinksCsvFilename(new Date('2026-10-10T09:00:00Z'))).toBe('setup-links-2026-10-10.csv');
  });
});

describe('setup → two-step hand-off', () => {
  beforeEach(() => sessionStorage.clear());
  const env = { mfaRequired: true as const, mfaEnrollmentRequired: true, mfaMethods: [], mfaToken: 'tok' };

  it('round-trips once, then is gone', () => {
    expect(stashSetupTwoStep('Dana@Riot.test', env)).toBe(true);
    expect(takeSetupTwoStep()).toEqual({ email: 'dana@riot.test', envelope: env });
    expect(takeSetupTwoStep()).toBeNull();
    expect(sessionStorage.getItem(SETUP_TWO_STEP_HANDOFF_KEY)).toBeNull();
  });

  it('refuses a stale, malformed or tokenless hand-off', () => {
    stashSetupTwoStep('a@b.c', env, Date.now() - 5 * 60_000);
    expect(takeSetupTwoStep()).toBeNull();
    sessionStorage.setItem(SETUP_TWO_STEP_HANDOFF_KEY, '{nope');
    expect(takeSetupTwoStep()).toBeNull();
    sessionStorage.setItem(SETUP_TWO_STEP_HANDOFF_KEY, JSON.stringify({ email: 'a@b.c', envelope: { mfaRequired: true }, at: Date.now() }));
    expect(takeSetupTwoStep()).toBeNull();
  });

  it('recognises only a real second-step envelope', () => {
    expect(isTwoStepEnvelope(env)).toBe(true);
    expect(isTwoStepEnvelope({ access_token: 'x' })).toBe(false);
    expect(isTwoStepEnvelope({ mfaRequired: true })).toBe(false);
  });
});
