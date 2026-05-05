/**
 * AiKeyController — BYOK CRUD for the operator's AI provider key.
 *
 * 2026-05-04. Sprint top-tier follow-up to AiService.
 * Operator: "let the end user just type in their credentials of their
 * AI of choice and then use their account and that way we don't have
 * to worry about paying for anything."
 *
 *   GET    /api/v1/ai/key    → status (configured? provider? when set?)
 *   POST   /api/v1/ai/key    → set / replace key (validates with a
 *                              one-shot test call BEFORE saving)
 *   DELETE /api/v1/ai/key    → clear key, fall back to platform default
 *
 * Security:
 *   - Key never returned in any response. Status endpoint returns a
 *     mask + provider name only.
 *   - DISTRICT_ADMIN + SCHOOL_ADMIN can set/clear; everyone else is
 *     read-only. SUPER_ADMIN is implicit via @RequireRoles wildcard.
 *   - Audit log entry on every create / replace / delete with the
 *     acting user id. Keys are envelope-encrypted at rest with the
 *     same DEVICE_SECRET_KEY pattern as streaming creds.
 *   - Test call is non-billing — uses max_tokens=10 with a trivial
 *     prompt. ~$0.0001 per validation, paid by THEM (BYOK).
 */

import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Post, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { sealAiKey, openAiKey, maskAiKey } from './ai-key-cipher';
import { coerceProvider, validateApiKeyShape, dispatchAi } from './ai-providers';

interface SetKeyBody { provider?: string; apiKey?: string; }

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ai/key')
export class AiKeyController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only status. Anyone in the tenant who can reach the editor
   * needs this to render the BYOK card — including CONTRIBUTORs (they
   * see "AI is configured by your admin, generate freely") but cannot
   * change the key.
   */
  @Get()
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  async getStatus(@Request() req: any) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: {
        aiProvider: true,
        aiKeyEncrypted: true,
        aiKeySetAt: true,
        aiKeySetByUserId: true,
      } as any,
    }) as any;
    const platformKeyAvailable = !!process.env.ANTHROPIC_API_KEY;
    if (!tenant?.aiKeyEncrypted) {
      return {
        configured: false,
        provider: null,
        keyMask: null,
        setAt: null,
        setByUserId: null,
        // Tells the UI "even without your own key, AI works using our
        // free trial." Prompts the operator to BYOK to remove the
        // platform's per-tenant cap if they're hitting it.
        platformFallbackAvailable: platformKeyAvailable,
      };
    }
    // Decrypt only to mask — never log, never return the raw key.
    let keyMask: string | null = null;
    try {
      keyMask = maskAiKey(openAiKey(tenant.aiKeyEncrypted));
    } catch {
      // If we can't decrypt (master key rotated?), surface so the
      // operator knows to re-enter.
      keyMask = '••••••••';
    }
    return {
      configured: true,
      provider: tenant.aiProvider,
      keyMask,
      setAt: tenant.aiKeySetAt,
      setByUserId: tenant.aiKeySetByUserId,
      platformFallbackAvailable: platformKeyAvailable,
    };
  }

  /**
   * Set or replace the tenant's AI provider key.
   *
   * Flow:
   *   1) Validate shape locally (avoids burning a real call on a typo)
   *   2) Test the key with a one-shot tiny generate against the chosen
   *      provider. If THAT 401s/4xxs, we refuse to save and surface
   *      the provider error to the operator. They get one shot to fix
   *      the typo before we even touch the DB.
   *   3) Encrypt + persist + audit.
   */
  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setKey(@Request() req: any, @Body() body: SetKeyBody) {
    const provider = coerceProvider(body?.provider);
    if (!provider) {
      throw new HttpException(
        'Pick a provider: "anthropic" or "openai".',
        HttpStatus.BAD_REQUEST,
      );
    }
    const apiKey = (body?.apiKey || '').trim();
    const shapeError = validateApiKeyShape(provider, apiKey);
    if (shapeError) {
      throw new HttpException(shapeError, HttpStatus.BAD_REQUEST);
    }

    // Test the key — refuse to save anything that doesn't work.
    const testResult = await dispatchAi(provider, {
      apiKey,
      system: 'Reply with the single character "ok" and nothing else.',
      userPrompt: 'ping',
      maxTokens: 10,
    });
    if (testResult.errorStatus) {
      // Bubble up the provider's error in a clean way. 401 = wrong
      // key. 403 = key fine but lacks model permissions. Other = give
      // the status code so the operator can google.
      let detail = `Provider rejected the key (${testResult.errorStatus}).`;
      if (testResult.errorStatus === 401) {
        detail = `That ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} key was rejected. Double-check you copied the full key from your provider dashboard.`;
      } else if (testResult.errorStatus === 403) {
        detail = `Key works but doesn't have access to the model we use. Make sure your ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} plan includes the cheapest tier.`;
      } else if (testResult.errorStatus === 429) {
        detail = `Provider rate-limited the test request. Try again in a moment — the key itself may be fine.`;
      }
      throw new HttpException(detail, HttpStatus.BAD_REQUEST);
    }

    const sealed = sealAiKey(apiKey);
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        aiProvider: provider,
        aiKeyEncrypted: sealed,
        aiKeySetAt: new Date(),
        aiKeySetByUserId: req.user.id,
      } as any,
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'AI_KEY_SET',
        targetType: 'tenant',
        targetId: req.user.tenantId,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        details: JSON.stringify({ provider }),
      },
    }).catch(() => { /* audit best-effort */ });

    return {
      ok: true,
      provider,
      keyMask: maskAiKey(apiKey),
      setAt: new Date().toISOString(),
    };
  }

  /**
   * Clear the tenant's AI key. Tenant falls back to platform free-trial
   * key if one is set on the deployment, else AI gracefully refuses.
   */
  @Delete()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async clearKey(@Request() req: any) {
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        aiProvider: null,
        aiKeyEncrypted: null,
        aiKeySetAt: null,
        aiKeySetByUserId: null,
      } as any,
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'AI_KEY_CLEARED',
        targetType: 'tenant',
        targetId: req.user.tenantId,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        details: JSON.stringify({}),
      },
    }).catch(() => {});
    return { ok: true };
  }
}
