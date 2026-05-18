/**
 * BillingWebhookController — Stripe's machine-to-machine webhook.
 *
 * UNAUTHENTICATED by design: Stripe POSTs here with no JWT and no
 * cookies. Authenticity is the Stripe signature, which
 * StripeService.constructWebhookEvent verifies against
 * STRIPE_WEBHOOK_SECRET — so CSRF's ambient-cookie threat model does
 * not apply (the path is on the CSRF exempt list in csrf.middleware).
 *
 * Signature verification needs the RAW request body — main.ts boots
 * the app with { rawBody: true }, so req.rawBody is a Buffer.
 *
 * Response contract:
 *   - bad / missing signature → 400 (Stripe will not retry — correct)
 *   - handler throws (e.g. DB hiccup) → 500 (Stripe retries the event)
 *   - handled OK / unknown event type → 200 { received: true }
 */
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { StripeService } from './stripe.service';

@Controller('api/v1/billing')
export class BillingWebhookController {
  constructor(private readonly stripe: StripeService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: any) {
    const signature = req.headers['stripe-signature'];
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody || typeof signature !== 'string') {
      throw new HttpException(
        'Missing raw body or stripe-signature header.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let event;
    try {
      event = this.stripe.constructWebhookEvent(rawBody, signature);
    } catch (e) {
      // Signature / secret failure — not retryable; answer 400.
      throw new HttpException(
        `Stripe webhook verification failed: ${(e as Error).message}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // A processing failure bubbles as 500 so Stripe retries the event.
    await this.stripe.handleWebhookEvent(event);
    return { received: true };
  }
}
