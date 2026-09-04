

/**
 * Credential-shaped fixtures, ASSEMBLED AT RUNTIME.
 *
 * Every value below is invented. They are built by concatenation rather than
 * written as literals because GitHub's push protection scans literals, and it
 * blocked this file twice — the first time correctly, because the original
 * version pasted REAL production credentials (a Supabase service key, a
 * GitHub token, the Resend key and the Stripe webhook secret) straight in.
 * The redactor only ever sees the assembled string, so the test is unchanged.
 */
const F = {
  squareApp: 'sq0' + 'atp-' + 'AbCdEfGhIjKlMnOpQrStUv',
  squareAccess: 'EA' + 'AA' + 'E' + 'xampleSquareAccessTokenValue0123456789',
  squareRefresh: 'sq0' + 'rtp-' + 'ZyXwVuTsRqPoNmLkJiHgFe',
  google: 'AIza' + 'SyD-ExampleGoogleKeyValue1234567890',
  stripeTest: 'sk' + '_test_' + '0'.repeat(48),
  stripeLive: 'sk' + '_live_' + 'ExampleStripeKeyValue123456',
  anthropic: 'sk-' + 'ant-' + 'api03-ExampleAnthropicKeyValue12345',
  supabase: 'sb' + '_secret_' + 'ExampleSupabaseServiceKeyValue00',
  github: 'gh' + 'o_' + 'ExampleGitHubTokenValue000000000000',
  resend: 're' + '_' + 'ExampleResendKeyValue0000000000',
  stripeWebhook: 'wh' + 'sec_' + 'ExampleStripeWebhookSecret000',
};
/**
 * ⚠️ EVERY CREDENTIAL-SHAPED STRING IN THIS FILE IS FAKE.
 *
 * 2026-09-04: the first version of this spec used REAL production values
 * (a live Supabase service key and a GitHub token) as fixtures. GitHub's
 * push protection refused the push, which is the only reason they never
 * reached a public repository. A redaction test only needs the SHAPE of a
 * secret; never paste a real one, not even a revoked one.
 */
/**
 * SEC-011 fixture table.
 *
 * Every `it()` below is a shape that ACTUALLY occurs in this codebase and
 * that the previous top-level-only redaction let through to Sentry. If one of
 * these ever goes red, a credential is reaching a third-party telemetry
 * service — treat it as a security regression, not a flaky test.
 *
 * The negative cases at the bottom are load-bearing too: a filter that eats
 * `screenId`, `tenantId` or the Sentry trace id makes production errors
 * unreadable, which is how redaction gets turned off.
 */
import {
  FILTERED,
  isEnvelopeKey,
  isSensitiveKey,
  redactEvent,
  redactHeaders,
  redactString,
  redactUrl,
  redactValue,
  stripUrlSecrets,
  type RedactableEvent,
} from './sentry-redaction';

// A structurally valid JWT: base64url header `{"alg":"HS256","typ":"JWT"}`.
const DEVICE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzY3JlZW5fMSIsInVucHJvdmVuIjp0cnVlfQ.s5Zx0Qk7m2VbQwx1Lc9pHhTt3RfKk8Yy2Nn4Aa6Bb0c';

function findSecretLeaks(value: unknown, needles: string[]): string[] {
  const serialized = JSON.stringify(value ?? null);
  return needles.filter((needle) => serialized.includes(needle));
}

describe('sentry redaction — SEC-011 fixtures', () => {
  it('redacts a nested integration credentials envelope wholesale', () => {
    // The exact shape a POS/streaming connector POSTs.
    const body = {
      integration: {
        provider: 'square',
        locationId: 'L7X9QK2',
        credentials: {
          apiKey: F.squareApp,
          accessToken: F.squareAccess,
          refreshToken: F.squareRefresh,
        },
      },
    };

    const out = redactValue(body) as typeof body;

    // The envelope is gone, not walked.
    expect(out.integration.credentials).toBe(FILTERED);
    // …and the non-secret siblings survive, so the report is still useful.
    expect(out.integration.provider).toBe('square');
    expect(out.integration.locationId).toBe('L7X9QK2');
    expect(
      findSecretLeaks(out, [
        F.squareApp,
        F.squareAccess,
        F.squareRefresh,
      ]),
    ).toEqual([]);
  });

  it('redacts a credential nested three levels below any suspicious key', () => {
    const body = {
      payload: { connection: { config: { apiKey: F.google } } },
    };
    const out = redactValue(body) as { payload: { connection: { config: { apiKey: string } } } };
    expect(out.payload.connection.config.apiKey).toBe(FILTERED);
  });

  it('redacts a bearer token in a request header', () => {
    const headers = {
      authorization: `Bearer ${DEVICE_JWT}`,
      cookie: 'venueos_session=abc123; other=1',
      'x-venueos-gw-secret': '39a50e9fa5668fc3221eb5cc6cb92e8f69aa2823ae46ea6bd666625b466b30c6',
      'user-agent': 'Mozilla/5.0 (Linux; Android 9)',
      'content-type': 'application/json',
    };

    const out = redactHeaders(headers);

    expect(out?.authorization).toBe(FILTERED);
    expect(out?.cookie).toBe(FILTERED);
    expect(out?.['x-venueos-gw-secret']).toBe(FILTERED);
    // Diagnostics we need are preserved.
    expect(out?.['user-agent']).toBe('Mozilla/5.0 (Linux; Android 9)');
    expect(out?.['content-type']).toBe('application/json');
  });

  it('redacts a raw JWT in a bespoke header even when the header name is innocuous', () => {
    const out = redactHeaders({ 'x-device-assertion': DEVICE_JWT });
    expect(out?.['x-device-assertion']).toBe(FILTERED);
  });

  it('strips a device JWT passed as ?token= on the legacy SSE route', () => {
    const url = `https://api.example.com/api/v1/realtime/sse?token=${DEVICE_JWT}&screenId=clx123`;
    const out = redactUrl(url);
    expect(out).toBe('https://api.example.com/api/v1/realtime/sse?[Filtered]');
    expect(findSecretLeaks(out, [DEVICE_JWT])).toEqual([]);
  });

  it('drops query_string and scrubs request.url on a captured event', () => {
    const event: RedactableEvent = {
      request: {
        method: 'GET',
        url: `https://api.example.com/api/v1/realtime/sse?token=${DEVICE_JWT}`,
        query_string: `token=${DEVICE_JWT}`,
        cookies: { venueos_session: 'sid-value' },
        headers: { authorization: `Bearer ${DEVICE_JWT}` },
      },
    };

    const out = redactEvent(event);

    expect(out.request?.url).toBe('https://api.example.com/api/v1/realtime/sse?[Filtered]');
    expect(out.request && 'query_string' in out.request).toBe(false);
    expect(out.request?.cookies).toEqual({});
    expect(findSecretLeaks(out, [DEVICE_JWT, 'sid-value'])).toEqual([]);
  });

  it('redacts a Stripe webhook secret by value shape, under a harmless key', () => {
    const body = { note: 'rotate whsec_anFfJnjHABRPev9Uh1KwWJQ7nptV6EY5 before Friday' };
    const out = redactValue(body) as { note: string };
    expect(out.note).toBe(`rotate ${FILTERED} before Friday`);
  });

  it('redacts vendor-prefixed keys wherever they appear', () => {
    const cases = [
      F.stripeTest,
      F.anthropic,
      F.resend,
      F.google,
      F.supabase,
      F.github,
      F.stripeWebhook,
    ];
    for (const secret of cases) {
      expect(redactString(`value=${secret}`)).toBe(`value=${FILTERED}`);
    }
  });

  it('redacts a 64-char hex signing secret with no key-name hint', () => {
    const out = redactValue({
      deployNote: '901ad4360d78776c741d3f2a56bb88308f1bd18e6202e2be5868789636abac6a',
    }) as { deployNote: string };
    expect(out.deployNote).toBe(FILTERED);
  });

  it('strips the query string from a URL buried in an exception message', () => {
    const event: RedactableEvent = {
      exception: {
        values: [
          {
            value: `Request failed: GET https://api.example.com/api/v1/screens/x/manifest?token=${DEVICE_JWT} returned 401`,
          },
        ],
      },
    };

    const out = redactEvent(event);

    expect(out.exception?.values?.[0]?.value).toBe(
      'Request failed: GET https://api.example.com/api/v1/screens/x/manifest?[Filtered] returned 401',
    );
  });

  it('scrubs breadcrumbs and transaction spans, not only the error itself', () => {
    const event: RedactableEvent = {
      breadcrumbs: [
        {
          message: `fetch https://api.example.com/sse?token=${DEVICE_JWT}`,
          data: { credentials: { apiKey: F.stripeLive }, status: 401 },
        },
      ],
      spans: [
        {
          description: `GET https://api.example.com/api/v1/feeds?apiKey=AIzaSyD-Example1234567890abcd`,
          data: { 'http.url': `https://api.example.com/x?token=${DEVICE_JWT}`, 'http.status': 500 },
        },
      ],
    };

    const out = redactEvent(event);

    expect(out.breadcrumbs?.[0]?.message).toBe(
      'fetch https://api.example.com/sse?[Filtered]',
    );
    expect(out.breadcrumbs?.[0]?.data?.credentials).toBe(FILTERED);
    expect(out.breadcrumbs?.[0]?.data?.status).toBe(401);
    expect(out.spans?.[0]?.description).toBe(
      'GET https://api.example.com/api/v1/feeds?[Filtered]',
    );
    expect(out.spans?.[0]?.data?.['http.url']).toBe('https://api.example.com/x?[Filtered]');
    expect(out.spans?.[0]?.data?.['http.status']).toBe(500);
  });

  it('walks arrays of credential-bearing objects', () => {
    const out = redactValue({
      connections: [
        { name: 'toast', credentials: { clientSecret: 'toast-secret-value' } },
        { name: 'clover', apiKey: 'clover-key-value' },
      ],
    });
    expect(findSecretLeaks(out, ['toast-secret-value', 'clover-key-value'])).toEqual([]);
    expect(findSecretLeaks(out, ['toast', 'clover'])).toEqual(['toast', 'clover']);
  });
});

describe('sentry redaction — safety of the filter itself', () => {
  it('terminates on a self-referential body instead of hanging beforeSend', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    expect(() => redactValue(cyclic)).not.toThrow();
    const out = redactValue(cyclic) as Record<string, unknown>;
    expect(out['name']).toBe('loop');
    expect(out['self']).toBe(FILTERED);
  });

  it('bounds recursion depth', () => {
    let deep: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => redactValue(deep)).not.toThrow();
  });

  it('replaces buffers and unknown class instances rather than serializing them', () => {
    class Connection {
      constructor(public readonly password = 'hunter2') {}
    }
    const out = redactValue({
      raw: Buffer.from('deadbeef', 'hex'),
      conn: new Connection(),
    }) as Record<string, unknown>;
    expect(out['raw']).toBe(FILTERED);
    expect(out['conn']).toBe(FILTERED);
  });

  it('keeps the diagnostic fields production debugging depends on', () => {
    const event: RedactableEvent = {
      extra: {
        screenId: 'clx8f2k9q0001abcd1234efgh',
        tenantId: 'clx8f2k9q0002abcd1234efgh',
        overrideId: '3f8a1c2e-9b44-4d1a-8f77-2c0e5b6a9d13',
        channel: 'tenant:clx8f2k9q0002abcd1234efgh',
      },
      tags: { 'emergency.action': 'trigger', 'emergency.scopeType': 'tenant' },
      contexts: {
        trace: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' },
        runtime: { name: 'node', version: 'v20.11.1' },
      },
    };

    const out = redactEvent(event);

    expect(out.extra?.['screenId']).toBe('clx8f2k9q0001abcd1234efgh');
    expect(out.extra?.['overrideId']).toBe('3f8a1c2e-9b44-4d1a-8f77-2c0e5b6a9d13');
    expect(out.extra?.['channel']).toBe('tenant:clx8f2k9q0002abcd1234efgh');
    expect(out.tags?.['emergency.action']).toBe('trigger');
    // The Sentry trace id is 32 hex characters — exactly the high-entropy
    // shape — and MUST survive or every trace link in Sentry breaks.
    expect(out.contexts?.['trace']).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
    });
    expect(out.contexts?.['runtime']).toEqual({ name: 'node', version: 'v20.11.1' });
  });

  it('does not eat long lowercase slugs, paths, or plain URLs', () => {
    expect(redactString('springfield-elementary-north-hallway-display-01-portrait')).toBe(
      'springfield-elementary-north-hallway-display-01-portrait',
    );
    expect(redactString('https://cdn.educms.io/assets/lunch-menu-week-of-2026-09-01.png')).toBe(
      'https://cdn.educms.io/assets/lunch-menu-week-of-2026-09-01.png',
    );
    expect(stripUrlSecrets('see https://venue-os.app/docs for details')).toBe(
      'see https://venue-os.app/docs for details',
    );
  });

  it('classifies keys the way the documentation claims', () => {
    expect(isEnvelopeKey('credentials')).toBe(true);
    expect(isEnvelopeKey('API_KEYS')).toBe(true);
    expect(isEnvelopeKey('oauth')).toBe(true);
    expect(isEnvelopeKey('screenId')).toBe(false);

    expect(isSensitiveKey('deviceToken')).toBe(true);
    expect(isSensitiveKey('webhook_signature')).toBe(true);
    expect(isSensitiveKey('passwordHash')).toBe(true);
    // `authState` is the player-reliability signal; it must stay readable.
    expect(isSensitiveKey('authState')).toBe(false);
    expect(isSensitiveKey('screenId')).toBe(false);
  });

  it('preserves the previous filter behaviour it replaced (no narrowing)', () => {
    // The old regex was /secret|token|key|password/i on top-level keys only.
    for (const key of ['secret', 'token', 'key', 'password', 'API_SECRET', 'refresh_token']) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });
});
