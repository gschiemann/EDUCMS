import { Controller, Post, Body, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Request } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  async login(@Body() body: any, @Req() req: Request) {
    const { username, password } = body;
    
    // Stub: lookup hash from db. 
    const mockHash = await this.authService.hashPassword('admin123'); 
    const isValid = await this.authService.verifyPassword(password, mockHash);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login('mock-user-123', req);
  }

  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  async refresh(@Body() body: { userId: string, refreshToken: string }) {
    if (!body.refreshToken || !body.userId) {
       throw new UnauthorizedException('Require userId and refreshToken');
    }
    
    // Perform Refresh Token Rotation
    return this.authService.refreshSession(body.userId, body.refreshToken);
  }
}
