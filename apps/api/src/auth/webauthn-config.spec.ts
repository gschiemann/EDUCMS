/**
 * Relying-party resolution — the module that decides WHICH DOMAIN a passkey
 * is welded to. Pure, so every case is a direct call with an injected env.
 */

import {
  resolveRelyingParty,
  requestOriginHeader,
  WEBAUTHN_RP_NAME,
  __resetWebAuthnConfigWarningForTests,
} from './webauthn-config';

const DASHBOARD = 'https://app.venueos.example';
const SECOND = 'https://admin.venueos.example';

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: `${DASHBOARD},${SECOND}`,
    ...overrides,
  };
}

beforeEach(() => __resetWebAuthnConfigWarningForTests());

describe('resolveRelyingParty — derived from the CORS allowlist', () => {
  it('binds to the hostname of an allowlisted origin', () => {
    const rp = resolveRelyingParty({ requestOrigin: DASHBOARD, env: env() });
    expect(rp).toEqual({
      rpID: 'app.venueos.example',
      rpName: WEBAUTHN_RP_NAME,
      origin: DASHBOARD,
    });
  });

  it('picks the origin that actually made the request, not the first listed', () => {
    expect(
      resolveRelyingParty({ requestOrigin: SECOND, env: env() })?.origin,
    ).toBe(SECOND);
    expect(
      resolveRelyingParty({ requestOrigin: SECOND, env: env() })?.rpID,
    ).toBe('admin.venueos.example');
  });

  it('REFUSES an origin that is not on the allowlist', () => {
    expect(
      resolveRelyingParty({
        requestOrigin: 'https://evil.example',
        env: env(),
      }),
    ).toBeNull();
  });

  it('REFUSES a suffix impostor — matching is exact-origin, never endsWith', () => {
    // The trap `NEXT_PUBLIC_API_ROOT_ALLOWLIST` documents: a naive suffix
    // test would accept this, and a passkey would then be mintable on a
    // domain the attacker controls.
    expect(
      resolveRelyingParty({
        requestOrigin: 'https://app.venueos.example.evil.com',
        env: env(),
      }),
    ).toBeNull();
    expect(
      resolveRelyingParty({
        requestOrigin: 'https://evil-app.venueos.example',
        env: env(),
      }),
    ).toBeNull();
  });

  it('REFUSES http for a non-loopback host even when the https form is allowed', () => {
    expect(
      resolveRelyingParty({
        requestOrigin: 'http://app.venueos.example',
        env: env(),
      }),
    ).toBeNull();
  });

  it('REFUSES when the request carries no Origin header at all', () => {
    // There is nothing to derive an rpID from, and guessing one would be the
    // attacker-chosen rpID this module exists to prevent.
    expect(resolveRelyingParty({ requestOrigin: null, env: env() })).toBeNull();
    expect(resolveRelyingParty({ env: env() })).toBeNull();
  });

  it('REFUSES junk that is not a parseable origin', () => {
    for (const bad of [
      '',
      '   ',
      'not-a-url',
      'javascript:alert(1)',
      'ftp://x.example',
    ]) {
      expect(
        resolveRelyingParty({ requestOrigin: bad, env: env() }),
      ).toBeNull();
    }
  });

  it('normalizes a trailing slash and a default port so operator formatting cannot break matching', () => {
    const rp = resolveRelyingParty({
      requestOrigin: 'https://app.venueos.example:443/',
      env: env({ ALLOWED_ORIGINS: 'https://app.venueos.example/' }),
    });
    expect(rp?.origin).toBe(DASHBOARD);
    expect(rp?.rpID).toBe('app.venueos.example');
  });

  it('ignores an empty ALLOWED_ORIGINS rather than defaulting to something', () => {
    expect(
      resolveRelyingParty({
        requestOrigin: DASHBOARD,
        env: env({ ALLOWED_ORIGINS: '' }),
      }),
    ).toBeNull();
    expect(
      resolveRelyingParty({
        requestOrigin: DASHBOARD,
        env: env({ ALLOWED_ORIGINS: undefined }),
      }),
    ).toBeNull();
  });
});

describe('resolveRelyingParty — loopback is a DEV-ONLY concession', () => {
  it('accepts http loopback outside production, with the port stripped from rpID', () => {
    const rp = resolveRelyingParty({
      requestOrigin: 'http://localhost:3000',
      env: env({ NODE_ENV: 'development', ALLOWED_ORIGINS: '' }),
    });
    // rpID carries no port — a credential registered here is scoped to the
    // bare host, which is what the platform authenticator expects.
    expect(rp).toEqual({
      rpID: 'localhost',
      rpName: WEBAUTHN_RP_NAME,
      origin: 'http://localhost:3000',
    });

    expect(
      resolveRelyingParty({
        requestOrigin: 'http://127.0.0.1:3000',
        env: env({ NODE_ENV: 'test', ALLOWED_ORIGINS: '' }),
      })?.rpID,
    ).toBe('127.0.0.1');
  });

  it('REFUSES loopback in production', () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      expect(
        resolveRelyingParty({ requestOrigin: origin, env: env() }),
      ).toBeNull();
    }
  });

  it('does not extend the concession to other private hosts', () => {
    expect(
      resolveRelyingParty({
        requestOrigin: 'http://192.168.1.50:3000',
        env: env({ NODE_ENV: 'development', ALLOWED_ORIGINS: '' }),
      }),
    ).toBeNull();
  });
});

describe('resolveRelyingParty — the explicit env override', () => {
  const override = env({
    WEBAUTHN_RP_ID: 'venueos.example',
    WEBAUTHN_ORIGINS: `${DASHBOARD},${SECOND}`,
  });

  it('uses the configured apex rpID while pinning the requesting origin', () => {
    const rp = resolveRelyingParty({ requestOrigin: SECOND, env: override });
    // The whole point of the override: one credential usable across several
    // subdomains, because the rpID is the shared apex.
    expect(rp).toEqual({
      rpID: 'venueos.example',
      rpName: WEBAUTHN_RP_NAME,
      origin: SECOND,
    });
  });

  it('still refuses an origin outside the configured list', () => {
    expect(
      resolveRelyingParty({
        requestOrigin: 'https://evil.example',
        env: override,
      }),
    ).toBeNull();
  });

  it('falls back to the FIRST configured origin when there is no Origin header', () => {
    // An origin WE chose, never a client-supplied one — a proxy that strips
    // the header must not brick passkeys.
    expect(
      resolveRelyingParty({ requestOrigin: null, env: override })?.origin,
    ).toBe(DASHBOARD);
  });

  it('IGNORES a half-configured override and derives from the allowlist instead', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const onlyId = resolveRelyingParty({
        requestOrigin: DASHBOARD,
        env: env({ WEBAUTHN_RP_ID: 'venueos.example' }),
      });
      // Derived, not overridden: the rpID is the request host, not the apex.
      expect(onlyId?.rpID).toBe('app.venueos.example');
      expect(warn).toHaveBeenCalled();

      __resetWebAuthnConfigWarningForTests();
      const onlyOrigins = resolveRelyingParty({
        requestOrigin: DASHBOARD,
        env: env({ WEBAUTHN_ORIGINS: 'https://venueos.example' }),
      });
      expect(onlyOrigins?.rpID).toBe('app.venueos.example');
    } finally {
      warn.mockRestore();
    }
  });

  it('an override origin list that parses to nothing falls through to the allowlist', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rp = resolveRelyingParty({
        requestOrigin: DASHBOARD,
        env: env({
          WEBAUTHN_RP_ID: 'venueos.example',
          WEBAUTHN_ORIGINS: ' , ,junk',
        }),
      });
      expect(rp?.rpID).toBe('app.venueos.example');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('requestOriginHeader', () => {
  it('reads the header and nothing else', () => {
    expect(requestOriginHeader({ headers: { origin: DASHBOARD } })).toBe(
      DASHBOARD,
    );
    // Node collapses duplicate headers into an array.
    expect(
      requestOriginHeader({
        headers: { origin: [DASHBOARD, 'https://evil.example'] },
      }),
    ).toBe(DASHBOARD);
  });

  it('is null for every shape that is not a usable header', () => {
    expect(requestOriginHeader({ headers: {} })).toBeNull();
    expect(requestOriginHeader({ headers: { origin: '' } })).toBeNull();
    expect(requestOriginHeader({})).toBeNull();
    expect(requestOriginHeader(undefined)).toBeNull();
    // A body field is NOT an origin — the helper only ever reads headers.
    expect(
      requestOriginHeader({
        body: { origin: 'https://evil.example' },
        headers: {},
      }),
    ).toBeNull();
  });
});
