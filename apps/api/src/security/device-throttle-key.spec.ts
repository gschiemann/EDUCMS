/**
 * device-throttle-key.spec.ts — the acceptance proof for P0-7 finding #1.
 *
 * THE DEFECT (measured, 1,000-screen load test 2026-09-04): the throttle key
 * was the client IP, a venue is one NAT address, and @nestjs/throttler keys
 * per handler — so the platform's real ceiling was "≈75 screens per building"
 * on the busiest route, and ≈31 with the push channel degraded.
 *
 * THE TWO PROPERTIES THIS FILE EXISTS TO HOLD:
 *   1. On the listed device routes, a VERIFIED device credential moves the key
 *      off the shared address and onto the screen.
 *   2. Nothing else moves. An anonymous route, an operator token, a forged or
 *      expired token, a token signed with the wrong secret, a non-device token
 *      — every one of them keeps the per-IP key, so no brute-force cap is
 *      weakened and no attacker can rotate the key by presenting junk.
 */

jest.mock('./required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import {
  DEVICE_ROUTE_LIMIT,
  DEVICE_THROTTLE_ROUTES,
  DEVICE_TRACKER_PREFIX,
  __resetDeviceThrottleMemo,
  deviceThrottleTracker,
  isDeviceThrottledRoute,
  verifiedDeviceSubject,
} from './device-throttle-key';

const SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-throttle-001';
const API_SRC = path.resolve(__dirname, '..');

const token = (claims: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) =>
  jwt.sign({ kind: 'device', sub: SCREEN_ID, ...claims }, SECRET, { expiresIn: '180d', ...opts });

const req = (auth?: string) => ({ headers: auth ? { authorization: auth } : {} }) as any;

/** Minimal ExecutionContext stand-in — the guard only reads class + handler names. */
const ctx = (cls: string, handler: string) =>
  ({
    getClass: () => ({ name: cls }),
    getHandler: () => ({ name: handler }),
  }) as any;

const REV = ctx('ScreensController', 'getEmergencyRev');

beforeEach(() => __resetDeviceThrottleMemo());

describe('the route allowlist is real and stays honest', () => {
  const sources = new Map<string, string>();
  const readAll = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        readAll(full);
      } else if (entry.name.endsWith('.controller.ts')) {
        sources.set(entry.name, fs.readFileSync(full, 'utf8'));
      }
    }
  };
  beforeAll(() => readAll(API_SRC));

  it('every allowlisted Controller#handler exists in the source', () => {
    const missing: string[] = [];
    for (const entry of DEVICE_THROTTLE_ROUTES) {
      const [cls, handler] = entry.split('#');
      const file = [...sources.values()].find((src) =>
        new RegExp(`export class ${cls}\\b`).test(src),
      );
      if (!file) {
        missing.push(`${entry} (no such controller class)`);
        continue;
      }
      // A class method at the conventional 2-space indent.
      if (!new RegExp(`^ {2}(?:private |public |protected )?(?:async )?${handler}\\s*\\(`, 'm').test(file)) {
        missing.push(`${entry} (class found, handler not)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does NOT contain any anonymous / brute-force route', () => {
    // These are the caps the audit says must not weaken. If a future change
    // adds one of them here, this test is the thing that stops it.
    const forbidden = [
      'register', // anonymous bootstrap — 120/min/IP is the Screen-row flood wall
      'pair',
      'login',
      'signup',
      'requestPasswordReset',
      'resetPassword',
      'proxyWeb',
      'renderCapability',
      'deviceInitiatedUnpair',
      'heartbeatProvesDevice',
    ];
    const handlers = DEVICE_THROTTLE_ROUTES.map((r) => r.split('#')[1]);
    for (const f of forbidden) expect(handlers).not.toContain(f);
  });

  it('carries the three routes that ARE the fleet load', () => {
    expect(DEVICE_THROTTLE_ROUTES).toEqual(
      expect.arrayContaining([
        'ScreensController#getEmergencyRev',
        'ScreensController#getManifest',
        'TelemetryController#report',
      ]),
    );
  });
});

describe('isDeviceThrottledRoute', () => {
  it('matches an allowlisted handler', () => {
    expect(isDeviceThrottledRoute(REV)).toBe(true);
  });
  it('does not match the login handler', () => {
    expect(isDeviceThrottledRoute(ctx('AuthController', 'login'))).toBe(false);
  });
  it('does not match a same-named handler on another controller', () => {
    expect(isDeviceThrottledRoute(ctx('SomeOtherController', 'getManifest'))).toBe(false);
  });
  it('is false, never throwing, for a broken context', () => {
    expect(isDeviceThrottledRoute(undefined)).toBe(false);
    expect(isDeviceThrottledRoute({} as any)).toBe(false);
    expect(
      isDeviceThrottledRoute({
        getClass: () => {
          throw new Error('boom');
        },
      } as any),
    ).toBe(false);
  });
});

describe('verifiedDeviceSubject — the token must actually verify', () => {
  it('returns the subject of a valid device token', () => {
    expect(verifiedDeviceSubject(req(`Bearer ${token()}`))).toBe(SCREEN_ID);
  });

  it('refuses a token signed with a DIFFERENT secret', () => {
    const forged = jwt.sign({ kind: 'device', sub: SCREEN_ID }, 'not-the-device-secret', {
      expiresIn: '1h',
    });
    expect(verifiedDeviceSubject(req(`Bearer ${forged}`))).toBeNull();
  });

  it('refuses an alg:none token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ kind: 'device', sub: SCREEN_ID })).toString('base64url');
    expect(verifiedDeviceSubject(req(`Bearer ${header}.${body}.`))).toBeNull();
  });

  it('refuses an expired token', () => {
    const stale = jwt.sign({ kind: 'device', sub: SCREEN_ID }, SECRET, { expiresIn: '-1s' });
    expect(verifiedDeviceSubject(req(`Bearer ${stale}`))).toBeNull();
  });

  it('refuses a NON-device token (an operator session JWT)', () => {
    const operator = jwt.sign({ sub: 'user-1', role: 'DISTRICT_ADMIN' }, SECRET, { expiresIn: '1h' });
    expect(verifiedDeviceSubject(req(`Bearer ${operator}`))).toBeNull();
  });

  it('refuses garbage, absent and non-JWT-shaped credentials', () => {
    expect(verifiedDeviceSubject(req())).toBeNull();
    expect(verifiedDeviceSubject(req('Bearer '))).toBeNull();
    expect(verifiedDeviceSubject(req('Bearer not-a-jwt'))).toBeNull();
    expect(verifiedDeviceSubject(req('Basic dXNlcjpwYXNz'))).toBeNull();
    expect(verifiedDeviceSubject(req(`Bearer ${'x'.repeat(9000)}`))).toBeNull();
  });

  it('refuses a device token whose subject is absurd', () => {
    expect(verifiedDeviceSubject(req(`Bearer ${token({ sub: 'x'.repeat(200) })}`))).toBeNull();
    expect(verifiedDeviceSubject(req(`Bearer ${token({ sub: 42 })}`))).toBeNull();
  });

  it('memoises the positive result (same answer on a repeat call)', () => {
    const t = `Bearer ${token()}`;
    expect(verifiedDeviceSubject(req(t))).toBe(SCREEN_ID);
    expect(verifiedDeviceSubject(req(t))).toBe(SCREEN_ID);
  });

  it('does not confuse two different screens', () => {
    const a = verifiedDeviceSubject(req(`Bearer ${token({ sub: 'screen-a' })}`));
    const b = verifiedDeviceSubject(req(`Bearer ${token({ sub: 'screen-b' })}`));
    expect(a).toBe('screen-a');
    expect(b).toBe('screen-b');
  });
});

describe('deviceThrottleTracker — the composition', () => {
  it('keys a device route + a valid credential on the SCREEN', () => {
    expect(deviceThrottleTracker(req(`Bearer ${token()}`), REV)).toBe(
      `${DEVICE_TRACKER_PREFIX}${SCREEN_ID}`,
    );
  });

  it('keeps the IP key on a device route with NO credential', () => {
    expect(deviceThrottleTracker(req(), REV)).toBeNull();
  });

  it('keeps the IP key on a device route with a FORGED credential', () => {
    const forged = jwt.sign({ kind: 'device', sub: SCREEN_ID }, 'wrong', { expiresIn: '1h' });
    expect(deviceThrottleTracker(req(`Bearer ${forged}`), REV)).toBeNull();
  });

  it('keeps the IP key on a NON-device route even with a perfect credential', () => {
    // The escape-hatch test: a stolen device token must not buy an attacker a
    // private bucket on the login brute-force cap.
    expect(deviceThrottleTracker(req(`Bearer ${token()}`), ctx('AuthController', 'login'))).toBeNull();
    expect(
      deviceThrottleTracker(req(`Bearer ${token()}`), ctx('ScreensController', 'register')),
    ).toBeNull();
    expect(
      deviceThrottleTracker(req(`Bearer ${token()}`), ctx('ScreensController', 'pair')),
    ).toBeNull();
  });

  it('two screens behind ONE address get two different keys', () => {
    const a = deviceThrottleTracker(req(`Bearer ${token({ sub: 'screen-a' })}`), REV);
    const b = deviceThrottleTracker(req(`Bearer ${token({ sub: 'screen-b' })}`), REV);
    expect(a).not.toBe(b);
  });

  it('a device key can never collide with an IP key', () => {
    // The IP tracker is a bare address; the device tracker is prefixed.
    expect(deviceThrottleTracker(req(`Bearer ${token({ sub: '203.0.113.9' })}`), REV)).toBe(
      'dev:203.0.113.9',
    );
  });
});

describe('the per-device ceiling', () => {
  it('is lower than the 600/min a whole building used to share', () => {
    expect(DEVICE_ROUTE_LIMIT).toBeLessThan(600);
  });
  it('is far above the 19 req/min/screen a DEGRADED player generates', () => {
    // 12 rev + 6 manifest + 1 telemetry, and that is the whole per-screen
    // budget spread across three separate per-handler counters.
    expect(DEVICE_ROUTE_LIMIT).toBeGreaterThan(19 * 10);
  });
});
