/**
 * SEC-010 — the CSP collector's parsing + redaction contract.
 *
 * The cross-browser cases are not padding: WebKit and the Chromium-83 Taurus
 * floor send ONLY the legacy `application/csp-report` shape, modern Chromium
 * sends the Reporting API array, and a collector that understands one of them
 * would quietly produce a Chromium-only picture of a fleet whose riskiest
 * surfaces are Safari operators and Android-9 panels.
 */
import {
  MAX_FIELD_CHARS,
  MAX_UNIQUE_PER_WINDOW,
  ReportThrottle,
  WINDOW_MS,
  formatReportLine,
  normalizeCspReport,
  reportKey,
  safeText,
  safeUrl,
  surfaceOf,
} from '../report-normalizer';

const DEVICE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzY3JlZW5fMSJ9.s5Zx0Qk7m2VbQwx1Lc9pHhTt3RfKk8Yy';

describe('CSP report normalizer — wire formats', () => {
  it('reads the legacy application/csp-report shape (WebKit, Chromium 83)', () => {
    const reports = normalizeCspReport({
      'csp-report': {
        'document-uri': 'https://venue-os.app/springfield/screens',
        'violated-directive': 'connect-src',
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://evil.example/collect',
        disposition: 'report',
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      directive: 'connect-src',
      blocked: 'https://evil.example/collect',
      document: 'https://venue-os.app/springfield/screens',
      disposition: 'report',
      sample: '',
    });
  });

  it('reads the Reporting API application/reports+json shape (modern Chromium)', () => {
    const reports = normalizeCspReport([
      {
        type: 'csp-violation',
        url: 'https://venue-os.app/player',
        body: {
          effectiveDirective: 'frame-src',
          blockedURL: 'https://evil.example/frame',
          documentURL: 'https://venue-os.app/player',
          disposition: 'report',
          sample: '',
        },
      },
      // A non-CSP report in the same envelope (deprecation, intervention).
      { type: 'deprecation', url: 'https://venue-os.app/player', body: { id: 'x' } },
    ]);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.directive).toBe('frame-src');
    expect(reports[0]?.blocked).toBe('https://evil.example/frame');
  });

  it('ignores junk without throwing', () => {
    expect(normalizeCspReport(null)).toEqual([]);
    expect(normalizeCspReport('not json object')).toEqual([]);
    expect(normalizeCspReport({ 'csp-report': 'string' })).toEqual([]);
    expect(normalizeCspReport([{ type: 'csp-violation' }])).toEqual([]);
    expect(normalizeCspReport({})).toEqual([]);
  });

  it('bounds how many reports one envelope can produce', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      type: 'csp-violation',
      body: { effectiveDirective: `d${i}`, blockedURL: 'https://x.example/', documentURL: '/' },
    }));
    expect(normalizeCspReport(many)).toHaveLength(20);
  });
});

describe('CSP report normalizer — redaction', () => {
  it('strips a device JWT carried in a blocked-uri query string', () => {
    const reports = normalizeCspReport({
      'csp-report': {
        'document-uri': `https://venue-os.app/player?token=${DEVICE_JWT}`,
        'effective-directive': 'connect-src',
        'blocked-uri': `https://api.example.com/api/v1/realtime/sse?token=${DEVICE_JWT}`,
      },
    });

    expect(reports[0]?.blocked).toBe('https://api.example.com/api/v1/realtime/sse?[redacted]');
    expect(reports[0]?.document).toBe('https://venue-os.app/player?[redacted]');
    expect(JSON.stringify(reports)).not.toContain(DEVICE_JWT);
  });

  it('strips a fragment as well as a query', () => {
    expect(safeUrl('https://venue-os.app/x#access_token=abc')).toBe(
      'https://venue-os.app/x?[redacted]',
    );
  });

  it('keeps a clean URL intact — the path is the diagnostic value', () => {
    expect(safeUrl('https://venue-os.app/springfield/templates/builder/abc123')).toBe(
      'https://venue-os.app/springfield/templates/builder/abc123',
    );
    expect(safeUrl('inline')).toBe('inline');
    expect(safeUrl(undefined)).toBe('');
  });

  it('strips control characters so a report cannot forge extra log lines', () => {
    const forged = 'connect-src\n[csp] report surface=player directive=FORGED';
    expect(safeText(forged)).not.toContain('\n');
    expect(safeText(forged)).toContain('FORGED');
  });

  it('truncates every field', () => {
    expect(safeText('a'.repeat(5000)).length).toBe(MAX_FIELD_CHARS);
    expect(safeUrl(`https://x.example/${'a'.repeat(5000)}`).length).toBe(MAX_FIELD_CHARS);
  });
});

describe('CSP report normalizer — surface routing', () => {
  it.each([
    ['https://venue-os.app/player', 'player'],
    ['https://venue-os.app/player/diagnostics', 'player'],
    ['https://venue-os.app/templates/hs/varsity.html', 'board'],
    ['https://venue-os.app/holiday-templates/halloween.html', 'board'],
    ['https://venue-os.app/celebrations/touchdown.html', 'board'],
    ['https://venue-os.app/demo/templates/rainbow.html', 'board'],
    ['https://venue-os.app/springfield/screens', 'dashboard'],
    ['https://venue-os.app/', 'dashboard'],
    ['', 'unknown'],
  ])('%s → %s', (url, expected) => {
    expect(surfaceOf(url)).toBe(expected);
  });

  it('formats one greppable line that names the surface', () => {
    const line = formatReportLine({
      directive: 'connect-src',
      blocked: 'https://evil.example/collect',
      document: 'https://venue-os.app/player',
      disposition: 'report',
      sample: '',
    });
    expect(line).toBe(
      '[csp] report surface=player directive=connect-src blocked=https://evil.example/collect doc=https://venue-os.app/player',
    );
  });

  it('labels an inline violation rather than printing an empty field', () => {
    const line = formatReportLine({
      directive: 'script-src',
      blocked: '',
      document: 'https://venue-os.app/springfield',
      disposition: 'enforce',
      sample: 'alert(1)',
    });
    expect(line).toContain('blocked=(inline)');
    expect(line).toContain('sample=alert(1)');
  });
});

describe('CSP report throttle', () => {
  it('logs a given violation once per window, not once per report', () => {
    const t = new ReportThrottle();
    const key = 'connect-src|https://evil.example/|dashboard';
    expect(t.shouldLog(key, 1_000)).toBe(true);
    expect(t.shouldLog(key, 2_000)).toBe(false);
    expect(t.shouldLog(key, 3_000)).toBe(false);
    // New window → the violation is worth one more line.
    expect(t.shouldLog(key, 1_000 + WINDOW_MS + 1)).toBe(true);
  });

  it('caps distinct violations so a flood cannot fill the log', () => {
    const t = new ReportThrottle();
    let accepted = 0;
    for (let i = 0; i < 500; i += 1) {
      if (t.shouldLog(`directive-${i}`, 1_000)) accepted += 1;
    }
    expect(accepted).toBe(MAX_UNIQUE_PER_WINDOW);
  });

  it('keys on (directive, blocked, surface) so player and dashboard do not mask each other', () => {
    const base = { directive: 'connect-src', blocked: 'https://x.example/', disposition: 'report', sample: '' };
    const onPlayer = reportKey({ ...base, document: 'https://venue-os.app/player' });
    const onDashboard = reportKey({ ...base, document: 'https://venue-os.app/springfield' });
    expect(onPlayer).not.toBe(onDashboard);

    const t = new ReportThrottle();
    expect(t.shouldLog(onPlayer, 0)).toBe(true);
    expect(t.shouldLog(onDashboard, 0)).toBe(true);
  });
});
