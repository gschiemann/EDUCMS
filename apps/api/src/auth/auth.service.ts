import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';

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
    if (!user) return null;

    // Audit fix #8: refuse login for users still in the INVITED state.
    // They must accept their invite and set a password before they can log
    // in directly. Without this gate, the placeholder password set during
    // invite creation could (in theory) be guessed before the operator
    // accepts.
    if (user.status && user.status !== 'ACTIVE') {
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
    // Look up the tenant slug for URL-friendly routing
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic
    };
    return {
      access_token: this.jwtService.sign(payload, rememberMe ? { expiresIn: '365d' } : undefined),
      user: {
        id: user.id, email: user.email, role: user.role,
        tenantId: user.tenantId, tenantSlug: tenant?.slug || user.tenantId,
        canTriggerPanic: user.canTriggerPanic,
      }
    };
  }
}
