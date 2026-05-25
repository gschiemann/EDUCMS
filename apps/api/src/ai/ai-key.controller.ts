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
import {
  coerceProvider, validateApiKeyShape, dispatchAi,
  AI_PROVIDERS, isKnownModel, defaultModelFor,
} from './ai-providers';
import { AiService } from './ai.service';

interface SetKeyBody { provider?: string; apiKey?: string; model?: string; }

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ai/key')
export class AiKeyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

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
        aiModel: true,
      } as any,
    }) as any;
    const platformKeyAvailable = !!process.env.ANTHROPIC_API_KEY;
    // Always include current usage snapshot — editor uses this to
    // render "X of 200 free this month" badge + cap-reached upgrade
    // modal.
    const usage = await this.aiService.getUsage(req.user.tenantId);
    if (!tenant?.aiKeyEncrypted) {
      return {
        configured: false,
        provider: null,
        model: null,
        keyMask: null,
        keyHealthy: null,
        setAt: null,
        setByUserId: null,
        platformFallbackAvailable: platformKeyAvailable,
        usage,
      };
    }
    // Audit-W4 fix (2026-05-25) — decryption can silently fail
    // after DEVICE_SECRET_KEY rotation, in which case every
    // generation falls back to the platform key and burns platform
    // quota WITHOUT any operator signal. Track health explicitly
    // and expose on the status endpoint so the UI can show a
    // "your saved key can't be decrypted — re-enter it" banner.
    let keyMask: string | null = null;
    let keyHealthy = true;
    try {
      keyMask = maskAiKey(openAiKey(tenant.aiKeyEncrypted));
    } catch {
      keyMask = '••••••••';
      keyHealthy = false;
    }
    // Audit-W7 fix (2026-05-25) — `setByUserId` exposed which admin
    // wired up the AI key, which a RESTRICTED_VIEWER doesn't need
    // to know. Limit to roles that can actually mutate the key
    // (and SUPER_ADMIN for cross-tenant support). CONTRIBUTOR also
    // hidden since they're read-only on this surface.
    const roleAllowsSetByUserId = [
      AppRole.SUPER_ADMIN,
      AppRole.DISTRICT_ADMIN,
      AppRole.SCHOOL_ADMIN,
    ].includes(req.user?.role);
    return {
      configured: true,
      provider: tenant.aiProvider,
      // If the saved model was removed from our catalog (provider
      // rebranded / we dropped support), surface the stored value as
      // null + let the FE re-pick. Dispatcher already falls through
      // to provider default at request time so generation stays live.
      model: tenant.aiModel && isKnownModel(coerceProvider(tenant.aiProvider) || 'anthropic', tenant.aiModel)
        ? tenant.aiModel
        : null,
      keyMask,
      keyHealthy,
      setAt: tenant.aiKeySetAt,
      setByUserId: roleAllowsSetByUserId ? tenant.aiKeySetByUserId : null,
      platformFallbackAvailable: platformKeyAvailable,
      usage,
    };
  }

  /**
   * Catalog of supported providers + models with cost estimates. The
   * settings UI fetches this on mount so a new model option ships
   * without a FE deploy. Public-readable inside the tenant; no
   * secrets leave the server.
   */
  @Get('catalog')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
  )
  async getCatalog() {
    return { providers: AI_PROVIDERS };
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
        'Pick a provider: "anthropic", "openai", or "google".',
        HttpStatus.BAD_REQUEST,
      );
    }
    const apiKey = (body?.apiKey || '').trim();
    const shapeError = validateApiKeyShape(provider, apiKey);
    if (shapeError) {
      throw new HttpException(shapeError, HttpStatus.BAD_REQUEST);
    }
    // Validate the requested model against our catalog. Empty string
    // / undefined means "use provider default" — accepted explicitly
    // to keep the legacy "no model column" rows working unchanged.
    const requestedModel = (body?.model || '').trim();
    if (requestedModel && !isKnownModel(provider, requestedModel)) {
      throw new HttpException(
        `Unknown model "${requestedModel}" for provider ${provider}. Pick one from the catalog.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const model = requestedModel || defaultModelFor(provider);

    // Test the key — refuse to save anything that doesn't work.
    // Note: tested with the chosen model so a key that's valid but
    // lacks access to that specific model fails here, not later when
    // an operator clicks "generate" and gets a confusing 403.
    const testResult = await dispatchAi(provider, {
      apiKey,
      model,
      system: 'Reply with the single character "ok" and nothing else.',
      userPrompt: 'ping',
      maxTokens: 10,
    });
    if (testResult.errorStatus) {
      // Bubble up the provider's error in a clean way. 401 = wrong
      // key. 403 = key fine but lacks model permissions. Other = give
      // the status code so the operator can google.
      let detail = `Provider rejected the key (${testResult.errorStatus}).`;
      const providerLabel =
        provider === 'anthropic' ? 'Anthropic'
        : provider === 'openai' ? 'OpenAI'
        : 'Google';
      if (testResult.errorStatus === 401) {
        detail = `That ${providerLabel} key was rejected. Double-check you copied the full key from your provider dashboard.`;
      } else if (testResult.errorStatus === 403) {
        detail = `Key works but doesn't have access to the "${model}" model. Pick a different model from the dropdown, or check your ${providerLabel} plan.`;
      } else if (testResult.errorStatus === 404) {
        detail = `The model "${model}" wasn't found on your ${providerLabel} account. Some models are gated by org / region — try a different one.`;
      } else if (testResult.errorStatus === 429) {
        // 2026-05-25 — OpenAI uses HTTP 429 for TWO different
        // situations: actual rate-limit AND "your API account has $0
        // in credits." They're disambiguated by `error.type` in the
        // body: 'insufficient_quota' = no money, 'rate_limit_exceeded'
        // / 'requests' = actual throttle. Common operator confusion:
        // ChatGPT Plus ($20/mo) is the chat website only, NOT API
        // credits — those are a separate balance at
        // platform.openai.com/settings/organization/billing.
        const body = testResult.errorBody || '';
        const isOutOfCredit =
          /insufficient_quota|exceeded your current quota|billing_hard_limit_reached|"type"\s*:\s*"insufficient_quota"/i.test(body);
        if (isOutOfCredit && provider === 'openai') {
          detail =
            `Your OpenAI API account has no credit balance. Heads up: ChatGPT Plus ($20/mo) only covers the chat website — API access is a separate balance. Add credits at platform.openai.com → Settings → Billing → Add to credit balance (minimum $5), then try again.`;
        } else if (isOutOfCredit) {
          detail = `Your ${providerLabel} account has no credit balance. Add funds to your billing settings and try again.`;
        } else {
          detail = `Provider rate-limited the test request. Try again in a moment — the key itself may be fine.`;
        }
      }
      throw new HttpException(detail, HttpStatus.BAD_REQUEST);
    }

    const sealed = sealAiKey(apiKey);
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        aiProvider: provider,
        aiModel: model,
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
        // Record provider + model (no key fragments) for forensics.
        details: JSON.stringify({ provider, model }),
      },
    }).catch(() => { /* audit best-effort */ });

    return {
      ok: true,
      provider,
      model,
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
        aiModel: null,
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
