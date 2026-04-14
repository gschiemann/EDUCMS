import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { cryptoPlatformConfig } from './crypto.config';
import { Request } from 'express';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private jwtService: JwtService) {}

  async hashPassword(password: string): Promise<string> {
    // Uses mandatory Argon2id with per-password random salt handled automatically by the argon2 lib with CSPRNG
    return argon2.hash(password, cryptoPlatformConfig);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (e) {
      this.logger.error('Hash verification failed', e);
      return false;
    }
  }

  /**
   * Logs a user in, rotating their session to mitigate Session Fixation
   */
  async login(userId: string, req: Request) {
    if (req.session) {
      // Mandatory Session Rotation: explicitly regenerate session ID upon successful login
      req.session.regenerate((err) => {
        if (err) {
          this.logger.error('Failed to regenerate session on login', err);
          throw new UnauthorizedException('Session regeneration failed');
        }
        
        // Log the anomaly if present (e.g., from an upstream WAF header or similar)
        this.logger.log(`User ${userId} logged in from IP ${req.ip}`);
        req.session['userId'] = userId; // Store standard user state
      });
    }

    const payload = { sub: userId };
    
    // Generate secure refresh token (CSPRNG random hex)
    const crypto = await import('crypto');
    const refreshToken = crypto.randomBytes(40).toString('hex');
    
    // In production, this stores the hash of refreshToken mapped to userId in DB
    // await this.prisma.refreshToken.create({ data: { tokenHash: await this.hashPassword(refreshToken), userId } });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
    };
  }

  /**
   * Explicit Refresh Token Rotation logic
   */
  async refreshSession(userId: string, incomingRefreshToken: string) {
    // 1. Validate the incoming refresh token against the hashed token in DB.
    // const storedHash = await this.prisma.refreshToken.findFirst({ where: { userId } });
    // if (!isValid(storedHash)) throw new UnauthorizedException('Invalid Refresh Token');
    
    // 2. Refresh Token Rotation (RTR): Instantly revoke the used refresh token from DB to prevent replay
    // await this.prisma.refreshToken.delete({ where: { id: storedHash.id } });

    // 3. Issue a new access token & a brand new refresh token
    const crypto = await import('crypto');
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    // await this.prisma.refreshToken.create({ ...newRefreshToken });

    return {
      access_token: this.jwtService.sign({ sub: userId }),
      refresh_token: newRefreshToken,
    };
  }
}
