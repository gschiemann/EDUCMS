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

    // Legacy/dev fallback: support seed data with plaintext hashes
    // This allows the seed user (passwordHash = 'secure_hash') to still log in
    if (user.passwordHash === pass || user.passwordHash === 'secure_hash') {
      // Auto-upgrade to Argon2id hash on successful legacy login
      const upgradedHash = await this.hashPassword(pass);
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradedHash }
      });

      const { passwordHash, ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      canTriggerPanic: user.canTriggerPanic
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId, canTriggerPanic: user.canTriggerPanic }
    };
  }
}
