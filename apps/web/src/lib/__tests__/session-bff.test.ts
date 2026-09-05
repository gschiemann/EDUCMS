/**
 * SEC-010 (2026-09-05) — the CSRF boundary for the durable-session cookie.
 *
 * Moving the credential into an HttpOnly cookie makes every route that reads
 * that cookie CSRF-relevant again: the browser will attach it to a request
 * the attacker composed, if the attacker can compose one. Three layers stop
 * that, and this file pins the two that live in code (the third,
 * `SameSite=Lax`, is set on the cookie itself in the route handlers):
 *
 *   1. a custom request header — an HTML form, the only cross-site POST that
 *      needs no CORS preflight, cannot set one;
 *   2. an `Origin` that must name the request's own `Host`.
 *
 * THE ACCEPTANCE CASE the audit asks for is the first `it` below: a
 * cross-origin POST that carries the cookie but not the header is refused.
 */
import {
  cookieMaxAgeFor,
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_REQUEST_HEADER,
  SESSION_REQUEST_HEADER_VALUE,
  verifySameOriginRequest,
} from '../session-bff';

function headers(map: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

const SITE = 'venue-os.app';

describe('verifySameOriginRequest — the CSRF gate on /api/session/*', () => {
  it('REFUSES a cross-origin POST that carries the cookie but no custom header', () => {
    // The browser attaches the cookie by ambient authority; the attacker's
    // page cannot add the header without a preflight we never answer. This
    // is the exact shape a form-post CSRF takes.
    const verdict = verifySameOriginRequest(
      headers({ host: SITE, origin: 'https://evil.example', 'content-type': 'text/plain' }),
    );
    expect(verdict).toEqual({ ok: false, reason: 'missing-header' });
  });

  it('REFUSES a cross-origin POST even when the attacker guesses the header', () => {
    // A cross-origin `fetch` CAN set a custom header — at the cost of a CORS
    // preflight, which these routes do not answer, so a real browser never
    // sends the POST. The Origin check makes that belt-and-braces rather
    // than a single point of failure.
    const verdict = verifySameOriginRequest(
      headers({
        host: SITE,
        origin: 'https://evil.example',
        [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
      }),
    );
    expect(verdict).toEqual({ ok: false, reason: 'cross-origin' });
  });

  it('REFUSES a look-alike origin (suffix games do not pass)', () => {
    for (const origin of [
      'https://venue-os.app.evil.example',
      'https://evilvenue-os.app',
      'https://venue-os.app:8443',
      'not a url',
    ]) {
      expect(
        verifySameOriginRequest(
          headers({
            host: SITE,
            origin,
            [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
          }),
        ),
      ).toEqual({ ok: false, reason: 'cross-origin' });
    }
  });

  it('ACCEPTS the real same-origin request the dashboard makes', () => {
    expect(
      verifySameOriginRequest(
        headers({
          host: SITE,
          origin: `https://${SITE}`,
          [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('ACCEPTS local dev over http on a port', () => {
    expect(
      verifySameOriginRequest(
        headers({
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('falls back to Sec-Fetch-Site when a browser omits Origin', () => {
    // Not every engine sends `Origin` in every shape, and WebKit has changed
    // its mind here before. Absence alone is not treated as an attack — the
    // custom header still had to be there — but a browser that TELLS us the
    // request is cross-site is believed.
    expect(
      verifySameOriginRequest(
        headers({
          host: SITE,
          [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toEqual({ ok: false, reason: 'cross-origin' });

    expect(
      verifySameOriginRequest(
        headers({ host: SITE, [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE }),
      ),
    ).toEqual({ ok: true });
  });

  it('a wrong header VALUE is as good as no header', () => {
    expect(
      verifySameOriginRequest(
        headers({ host: SITE, origin: `https://${SITE}`, [SESSION_REQUEST_HEADER]: 'yes' }),
      ),
    ).toEqual({ ok: false, reason: 'missing-header' });
  });
});

describe('cookieMaxAgeFor', () => {
  it('clamps to the 30-day ceiling and never revives a dead cookie', () => {
    expect(cookieMaxAgeFor(null)).toBe(SESSION_COOKIE_MAX_AGE_SEC);
    expect(cookieMaxAgeFor('not-a-date')).toBe(SESSION_COOKIE_MAX_AGE_SEC);
    expect(cookieMaxAgeFor(new Date(Date.now() - 1000).toISOString())).toBe(0);
    // A server that (somehow) offers 60 days still only gets 30.
    const far = new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
    expect(cookieMaxAgeFor(far)).toBe(SESSION_COOKIE_MAX_AGE_SEC);
    // The normal case tracks the API's own expiry.
    const inTwoDays = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    expect(cookieMaxAgeFor(inTwoDays)).toBeGreaterThan(2 * 24 * 3600 - 10);
    expect(cookieMaxAgeFor(inTwoDays)).toBeLessThanOrEqual(2 * 24 * 3600);
  });
});
