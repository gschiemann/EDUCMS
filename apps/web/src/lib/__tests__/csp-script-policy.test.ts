/**
 * SEC-010 — the enforced `script-src` policy and the routes it applies to.
 *
 * The property that matters most here is NEGATIVE: a prerendered route must
 * never be told to enforce a nonce, because its inline scripts were built
 * without one and the page would render blank. `tools/check-csp-prerender.cjs`
 * checks that against the real build manifest; these cases pin the rule itself.
 */
import {
  scriptSrcCsp,
  shouldEnforceScriptCsp,
  CSP_UNNONCEABLE_EXACT,
  CSP_UNNONCEABLE_PREFIXES,
} from '../csp-script-policy';

describe('shouldEnforceScriptCsp', () => {
  it('enforces on the authenticated dashboard — the surface the finding is about', () => {
    for (const p of [
      '/demo-school/dashboard',
      '/demo-school/screens',
      '/demo-school/settings/billing',
      '/demo-school/templates',
      '/board/abc',
      '/console',
      '/super/bugs/some-id',
    ]) {
      expect(shouldEnforceScriptCsp(p)).toBe(true);
    }
  });

  it('does NOT enforce on any prerendered route', () => {
    for (const p of CSP_UNNONCEABLE_EXACT) expect(shouldEnforceScriptCsp(p)).toBe(false);
    for (const p of CSP_UNNONCEABLE_PREFIXES) {
      expect(shouldEnforceScriptCsp(p)).toBe(false);
      expect(shouldEnforceScriptCsp(`${p}/anything/deeper`)).toBe(false);
    }
  });

  it('excludes EXACTLY, so a dynamic sibling of a prerendered route stays enforced', () => {
    // `/super/bugs` is prerendered; `/super/bugs/:id` is not. A prefix rule
    // here would have silently dropped the admin bug detail page out of the
    // policy — which is why these live in the exact list.
    expect(shouldEnforceScriptCsp('/super/bugs')).toBe(false);
    expect(shouldEnforceScriptCsp('/super/bugs/abc123')).toBe(true);
    expect(shouldEnforceScriptCsp('/reset-password/request')).toBe(false);
    expect(shouldEnforceScriptCsp('/reset-password/some-token')).toBe(true);
    expect(shouldEnforceScriptCsp('/login')).toBe(false);
    // A path that merely STARTS with an excluded name is not the excluded one.
    expect(shouldEnforceScriptCsp('/loginville')).toBe(true);
  });
});

describe('scriptSrcCsp', () => {
  const prevEnforce = process.env.CSP_SCRIPT_SRC_ENFORCE;
  const prevReport = process.env.CSP_REPORTING_DISABLED;
  afterEach(() => {
    if (prevEnforce === undefined) delete process.env.CSP_SCRIPT_SRC_ENFORCE;
    else process.env.CSP_SCRIPT_SRC_ENFORCE = prevEnforce;
    if (prevReport === undefined) delete process.env.CSP_REPORTING_DISABLED;
    else process.env.CSP_REPORTING_DISABLED = prevReport;
  });

  it('carries the nonce and NOT unsafe-inline', () => {
    const csp = scriptSrcCsp({ nonce: 'abc123', dev: false })!;
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('keeps the four directives next.config used to own — this header REPLACES that one', () => {
    const csp = scriptSrcCsp({ nonce: 'n', dev: false })!;
    for (const d of [
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(d);
    }
  });

  it('never emits default-src — this policy governs scripts and nothing else', () => {
    expect(scriptSrcCsp({ nonce: 'n', dev: false })!).not.toContain('default-src');
  });

  it('allows eval in dev only', () => {
    expect(scriptSrcCsp({ nonce: 'n', dev: true })!).toContain("'unsafe-eval'");
    expect(scriptSrcCsp({ nonce: 'n', dev: false })!).not.toContain("'unsafe-eval'");
  });

  it('the kill switch removes the header entirely, not partially', () => {
    for (const v of ['off', 'OFF', '0', 'false', 'report']) {
      process.env.CSP_SCRIPT_SRC_ENFORCE = v;
      expect(scriptSrcCsp({ nonce: 'n', dev: false })).toBeNull();
    }
    // Anything else — including a typo — leaves enforcement ON.
    for (const v of ['on', '1', 'yes', '']) {
      process.env.CSP_SCRIPT_SRC_ENFORCE = v;
      expect(scriptSrcCsp({ nonce: 'n', dev: false })).not.toBeNull();
    }
  });

  it('drops report-uri when reporting is disabled', () => {
    process.env.CSP_REPORTING_DISABLED = '1';
    expect(scriptSrcCsp({ nonce: 'n', dev: false })!).not.toContain('report-uri');
  });
});
