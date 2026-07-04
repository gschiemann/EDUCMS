/**
 * Security regression: /screens/register per-IP throttle (sec P2, 2026-07-03).
 *
 * THE BUG: POST /screens/register was decorated @SkipThrottle() AND is
 * unauthenticated by design. @SkipThrottle() removes not only any local
 * @Throttle but ALSO the global 600/min ThrottlerGuard — so the endpoint
 * had NO IP-based rate limit of any kind. The per-fingerprint cooldown
 * exempts brand-new/unknown fingerprints (it only slows a REPEAT of the
 * SAME fp), so a flood of UNIQUE fingerprints from one source never trips
 * it. Result: an unauthenticated attacker could create unbounded Screen
 * rows (DB bloat / resource exhaustion / fills tenant screen lists).
 *
 * THE FIX (v6): replace @SkipThrottle() with a GENEROUS per-IP throttle:
 *   @Throttle({ default: { limit: 120, ttl: 60_000 } })  // 120/min/IP
 * 120/min matches player-ota `update-check` (the other public endpoint
 * every kiosk in a NAT'd building hits on boot) — comfortably above any
 * legitimate mass rollout, while bounding an attacker to 120 rows/min/IP.
 *
 * These tests read the NestJS throttler metadata directly off the REAL
 * controller method, so they prove the decorator ships on the actual
 * shipped code (not a stub). The adversarial case proves the assertion
 * is load-bearing: if the fix were reverted to @SkipThrottle(), the
 * throttle-limit metadata disappears and the SKIP flag reappears.
 *
 * @Throttle metadata keys (empirically, @nestjs/throttler v6):
 *   THROTTLER:LIMIT<name>  → the numeric limit
 *   THROTTLER:TTL<name>    → the window in ms
 * @SkipThrottle metadata key:
 *   THROTTLER:SKIP<name>   → true
 * The default named throttler uses <name> = 'default'.
 */

import 'reflect-metadata';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ScreensController } from './screens.controller';

const LIMIT_KEY = 'THROTTLER:LIMITdefault';
const TTL_KEY = 'THROTTLER:TTLdefault';
const SKIP_KEY = 'THROTTLER:SKIPdefault';

// The concrete method the throttler guard inspects at request time.
const registerMethod = ScreensController.prototype.register;

describe('/screens/register — per-IP throttle (sec P2)', () => {
  it('applies a per-IP @Throttle to the real register handler (limit 120 / 60s)', () => {
    const limit = Reflect.getMetadata(LIMIT_KEY, registerMethod);
    const ttl = Reflect.getMetadata(TTL_KEY, registerMethod);

    // The throttle MUST be present — this is the whole fix.
    expect(limit).toBe(120);
    expect(ttl).toBe(60_000);
  });

  it('does NOT skip the throttler on register (no @SkipThrottle leftover)', () => {
    // @SkipThrottle() would set THROTTLER:SKIPdefault = true and disable
    // both the local @Throttle AND the global 600/min guard — the exact
    // bug. Prove it is not present on the shipped method.
    const skip = Reflect.getMetadata(SKIP_KEY, registerMethod);
    expect(skip).toBeUndefined();
  });

  it('uses a generous, non-bricking limit (>= 60/min) so a legit mass rollout succeeds', () => {
    // A whole NAT'd building of dozens of kiosks + dashboard users shares
    // ONE public IP. register is called ~once per kiosk boot (far less than
    // update-check's periodic polling), so 120/min in a per-MINUTE window
    // (resets each minute, never accumulates) comfortably clears a
    // synchronized reboot/OTA. Guard against a future over-tightening that
    // would re-introduce the v2/v4 NAT bricking.
    const limit = Reflect.getMetadata(LIMIT_KEY, registerMethod) as number;
    const ttl = Reflect.getMetadata(TTL_KEY, registerMethod) as number;
    expect(ttl).toBe(60_000); // per-minute window — no multi-hour accumulation
    expect(limit).toBeGreaterThanOrEqual(60);
  });

  // ── Adversarial proof the guard is load-bearing ────────────────────────
  // Reconstruct BOTH the buggy (@SkipThrottle) and fixed (@Throttle) states
  // on scratch methods and show the metadata differs exactly as the tests
  // above rely on. If someone reverts the fix to @SkipThrottle(), the
  // "limit === 120" assertion fails and the "skip === undefined" assertion
  // fails — the tests turn red, which is the point.
  it('ADVERSARIAL: @SkipThrottle (the reverted/buggy state) carries NO throttle limit and DOES set the skip flag', () => {
    class Buggy {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      register() {}
    }
    const desc = Object.getOwnPropertyDescriptor(Buggy.prototype, 'register')!;
    SkipThrottle()(Buggy.prototype, 'register', desc);
    const buggyMethod = desc.value;

    // The buggy state: skip flag SET, throttle limit ABSENT — i.e. the two
    // primary assertions above would both flip red under a revert.
    expect(Reflect.getMetadata(SKIP_KEY, buggyMethod)).toBe(true);
    expect(Reflect.getMetadata(LIMIT_KEY, buggyMethod)).toBeUndefined();
  });

  it('ADVERSARIAL: @Throttle (the fix) sets the throttle limit and NO skip flag — mirrors the shipped method', () => {
    class Fixed {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      register() {}
    }
    const desc = Object.getOwnPropertyDescriptor(Fixed.prototype, 'register')!;
    Throttle({ default: { limit: 120, ttl: 60_000 } })(Fixed.prototype, 'register', desc);
    const fixedMethod = desc.value;

    expect(Reflect.getMetadata(LIMIT_KEY, fixedMethod)).toBe(120);
    expect(Reflect.getMetadata(TTL_KEY, fixedMethod)).toBe(60_000);
    expect(Reflect.getMetadata(SKIP_KEY, fixedMethod)).toBeUndefined();

    // And this scratch-fixed method's throttle metadata MATCHES the real
    // shipped controller method — proving the shipped code carries the fix.
    expect(Reflect.getMetadata(LIMIT_KEY, registerMethod)).toBe(
      Reflect.getMetadata(LIMIT_KEY, fixedMethod),
    );
    expect(Reflect.getMetadata(TTL_KEY, registerMethod)).toBe(
      Reflect.getMetadata(TTL_KEY, fixedMethod),
    );
  });
});
