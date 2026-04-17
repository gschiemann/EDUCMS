import { Controller, Get, Req } from '@nestjs/common';
import { CSRF_COOKIE_NAME } from './csrf.middleware';

@Controller('api/v1/security')
export class CsrfController {
  @Get('csrf')
  issue(@Req() req: any): { token: string } {
    const minted = req.csrfToken as string | undefined;
    const existing = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
    return { token: minted ?? existing ?? '' };
  }
}
