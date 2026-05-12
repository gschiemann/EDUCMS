import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';

/**
 * auth-BUG-006: pre-computed Argon2id hash used as a timing decoy when
 * the user lookup misses. Without this, the "user not found" branch
 * skips the ~45ms argon2.verify call and returns ~200ms faster than
 * the "wrong password" branch — a measurable side channel that lets an
 * attacker enumerate which emails exist in the system. We compute this
 * once at module load using the project's argon2id params, then verify
 * against it on every miss so both branches take the same time.
 *
 * The plaintext "not_a_real_password" is a constant, not a secret —
 * its only purpose is to give argon2.verify something to chew on for
 * the same number of CPU cycles as the real path.
 */
const DUMMY_PASSWORD_FOR_TIMING = 'not_a_real_password';
const DUMMY_HASH_PROMISE: Promise<string> = argon2.hash(DUMMY_PASSWORD_FOR_TIMING, {
  type: cryptoPlatformConfig.type,
  memoryCost: cryptoPlatformConfig.memoryCost,
  timeCost: cryptoPlatformConfig.timeCost,
  parallelism: cryptoPlatformConfig.parallelism,
});

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  /**
   * Hash a password using Argon2id with platform-standard settings.
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: cryptoPlatformConfig.type,
      memoryCost: cryptoPlatformConfig.memoryCost,
      timeCost: cryptoPlatformConfig.timeCost,
      parallelism: cryptoPlatformConfig.parallelism,
    });
  }

  /**
   * Validate user credentials against stored Argon2id hash.
   * Falls back to legacy plaintext comparison for unseeded/dev accounts,
   * then auto-upgrades the hash.
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      // auth-BUG-006: even though we have nothing to verify, run a
      // dummy argon2.verify so the response time matches the
      // "user found, wrong password" branch. Otherwise an attacker
      // can enumerate valid emails by measuring the latency gap
      // (~200ms missing-user vs ~245ms wrong-password).
      try {
        const dummyHash = await DUMMY_HASH_PROMISE;
        await argon2.verify(dummyHash, pass, cryptoPlatformConfig);
      } catch {
        // Don't leak the dummy verify failing; just absorb.
      }
      return null;
    }

    // Audit fix #8: refuse login for users still in the INVITED state.
    // They must accept their invite and set a password before they can log
    // in directly. Without this gate, the placeholder password set during
    // invite creation could (in theory) be guessed before the operator
    // accepts.
    if (user.status && user.status !== 'ACTIVE') {
      // Same timing-equalization trick — run a dummy verify so an
      // attacker can't tell ACTIVE-but-wrong-password apart from
      // INVITED-but-correct-email-shape.
      try {
        const dummyHash = await DUMMY_HASH_PROMISE;
        await argon2.verify(dummyHash, pass, cryptoPlatformConfig);
      } catch {}
      return null;
    }

    // Try Argon2id verification first (production path)
    try {
      const isValid = await argon2.verify(user.passwordHash, pass, cryptoPlatformConfig);
      if (isValid) {
        const { passwordHash, ...result } = user;
        return result;
      }
    } catch {
      // Hash format not recognized by argon2 — fall through to legacy check
    }

    // Argon2id verification failed — reject
    return null;
  }

  async login(user: any, rememberMe?: boolean) {
    // Look up the tenant slug + vertical for URL-friendly routing AND
    // VenueOS-era vertical-aware UI copy. Vertical drives terminology,
    // template library filter, default emergency types — without it
    // the dashboard always renders K12 strings even on gym/retail
    // tenants.
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true, vertical: true, name: true },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic
    };
    return {
      // rememberMe was 365d — too long. A token leaked from a stolen
      // laptop or compromised browser session was good for a full year
      // with no rotation/refresh path. 30d is the reasonable upper
      // bound for "stay signed in" UX (shorter than typical password
      // policy, longer than a normal work session). After this expires,
      // the user is asked to log in again — same flow as no-rememberMe
      // hitting the default JWT TTL. Pair with refresh-token rotation
      // in a follow-up sprint to extend without re-prompting.
      access_token: this.jwtService.sign(payload, rememberMe ? { expiresIn: '30d' } : undefined),
      user: {
        id: user.id, email: user.email, role: user.role,
        // 2026-05-11 — first/last name in the login response so the
        // dashboard greeting + sidebar can render "Hi, Greg" without
        // a separate /users/me round trip. Null when the user hasn't
        // set them yet; client falls back to email-prefix.
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        tenantId: user.tenantId, tenantSlug: tenant?.slug || user.tenantId,
        tenantName: tenant?.name || null,
        tenantVertical: tenant?.vertical || 'K12',
        canTriggerPanic: user.canTriggerPanic,
      }
    };
  }
}
