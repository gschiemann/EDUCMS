import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomerConsoleService } from './customer-console.service';

/**
 * PUBLIC — the single-use owner link a SUPER_ADMIN hands a new customer
 * (/claim-account/<token> on the web origin).
 *
 * No session exists yet; the token IS the credential, exactly like an invite
 * link: 32 random bytes, stored only as its SHA-256, single use (the redeeming
 * write is conditional on `acceptedAt IS NULL`), 7-day expiry, and only ever a
 * starter-owner invite (an ordinary staff invite token answers "not valid"
 * here). Redeeming signs the person in ONCE into an account the API holds to
 * first-login setup until they have set their own email and password.
 *
 * CSRF: exempt in csrf.middleware.ts for the same reason as
 * /invites/:token/accept — no session, no cookie to round-trip, and the
 * capability is the unguessable token in the URL.
 */
@Controller('api/v1/customer-claims')
export class CustomerClaimController {
  constructor(private readonly customers: CustomerConsoleService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  preview(@Param('token') token: string) {
    return this.customers.claimPreview(token);
  }

  @Post(':token/claim')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  claim(@Param('token') token: string) {
    return this.customers.claim(token);
  }
}
