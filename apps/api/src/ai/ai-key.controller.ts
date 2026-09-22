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
  coerceProvider, validateApiKeyShape, dispatchAi, mapProviderQuotaError,
  aiProvidersForUi, isKnownModel, healLegacyModelId,
} from './ai-providers';
import { tierForSavedChoice } from './ai-legacy-models';
import { anyPlatformKey } from './ai-platform-keys';
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
    // Any of our vendor keys counts (2026-09-22 — our key can be Anthropic, OpenAI or Google).
    const platformKeyAvailable = anyPlatformKey();
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
      // 2026-09-22 — the saved value is a TIER (or, on rows saved before tiers, the id it was picked
      // as). Report the model that serves that tier TODAY, so the picker highlights the right
      // option even after the catalog adopts a newer release.
      model: healLegacyModelId(coerceProvider(tenant.aiProvider) || 'anthropic', tenant.aiModel),
      tier: tierForSavedChoice(coerceProvider(tenant.aiProvider) || 'anthropic', tenant.aiModel),
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
    // Built from the live catalog on every call — a model the daily sync adopts shows up here at
    // the next page load, with no deploy.
    return { providers: aiProvidersForUi() };
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
      throw new HttpException({ code: 'AI_KEY_PROVIDER_REQUIRED', message: 'Pick a provider: "anthropic", "openai", or "google".' }, HttpStatus.BAD_REQUEST);
    }
    const apiKey = (body?.apiKey || '').trim();
    const shapeError = validateApiKeyShape(provider, apiKey);
    if (shapeError) {
      throw new HttpException({ code: 'AI_KEY_SHAPE_INVALID', message: shapeError }, HttpStatus.BAD_REQUEST);
    }
    // Validate the requested model against our catalog. Empty string
    // / undefined means "use provider default" — accepted explicitly
    // to keep the legacy "no model column" rows working unchanged.
    const requestedModel = (body?.model || '').trim();
    if (requestedModel && !isKnownModel(provider, requestedModel)) {
      throw new HttpException({ code: 'AI_KEY_MODEL_UNKNOWN', message: `Unknown model "${requestedModel}" for provider ${provider}. Pick one from the catalog.` }, HttpStatus.BAD_REQUEST);
    }
    // 2026-09-22 — persist the TIER the operator picked, not the id: a saved "Premium" follows the
    // catalog to each newer Premium model; a saved id would go stale the month its vendor ships a
    // successor. The key is TESTED against the model serving that tier right now.
    const tier = tierForSavedChoice(provider, requestedModel || 'standard');
    const model = healLegacyModelId(provider, tier);

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
      // err-code sweep (task #57): default code mirrors the upstream
      // status; overwritten below with the provider-specific reason
      // when we can disambiguate one (quota code, or a 401/403/404/429
      // status-shaped code) so the frontend can map it to a real message
      // instead of a generic BAD_REQUEST.
      let code = 'AI_KEY_TEST_FAILED';
      const providerLabel =
        provider === 'anthropic' ? 'Anthropic'
        : provider === 'openai' ? 'OpenAI'
        : 'Google';
      // 2026-05-26 audit AI-P0-1 — out-of-credit disambiguation now
      // lives in the shared mapProviderQuotaError() helper used by
      // both this controller AND ai.service.ts:generate. Single source
      // of truth for "your API balance is $0" vs "you got throttled."
      const quotaErr = mapProviderQuotaError(provider, testResult.errorStatus, testResult.errorBody);
      if (quotaErr) {
        detail = quotaErr.message;
        code = quotaErr.code;
      } else if (testResult.errorStatus === 401) {
        detail = `That ${providerLabel} key was rejected. Double-check you copied the full key from your provider dashboard.`;
        code = 'AI_KEY_REJECTED';
      } else if (testResult.errorStatus === 403) {
        detail = `Key works but doesn't have access to the "${model}" model. Pick a different model from the dropdown, or check your ${providerLabel} plan.`;
        code = 'AI_KEY_MODEL_FORBIDDEN';
      } else if (testResult.errorStatus === 404) {
        detail = `The model "${model}" wasn't found on your ${providerLabel} account. Some models are gated by org / region — try a different one.`;
        code = 'AI_KEY_MODEL_NOT_FOUND';
      } else if (testResult.errorStatus === 429) {
        detail = `Provider rate-limited the test request. Try again in a moment — the key itself may be fine.`;
        code = 'AI_KEY_TEST_RATE_LIMITED';
      }
      // 2026-05-26 audit AI-P0-4 — log failed test-on-save attempts.
      // Without this, an attacker with a SCHOOL_ADMIN account can
      // silently probe arbitrary OpenAI / Anthropic / Google keys at
      // ~$0.0001/test, validating other people's credentials with no
      // forensic record. We log the PROVIDER + upstream STATUS only,
      // never the key (even masked — a partial key in the audit log
      // would be a credential leak through a different surface).
      await this.prisma.client.auditLog.create({
        data: {
          action: 'AI_KEY_TEST_FAILED',
          targetType: 'tenant',
          targetId: req.user.tenantId,
          tenantId: req.user.tenantId,
          userId: req.user.id,
          details: JSON.stringify({
            provider,
            model,
            upstreamStatus: testResult.errorStatus,
            quotaError: !!quotaErr,
          }),
        },
      }).catch(() => { /* audit best-effort */ });
      throw new HttpException({ code, message: detail }, HttpStatus.BAD_REQUEST);
    }

    const sealed = sealAiKey(apiKey);
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: {
        aiProvider: provider,
        aiModel: tier,
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
        // Record provider + tier + model (no key fragments) for forensics.
        details: JSON.stringify({ provider, tier, model }),
      },
    }).catch(() => { /* audit best-effort */ });

    return {
      ok: true,
      provider,
      model,
      tier,
      keyMask: maskAiKey(apiKey),
      setAt: new Date().toISOString(),
    };
  }

  /**
   * Change ONLY the model, reusing the already-stored key. Lets an
   * operator switch e.g. GPT-4o mini → GPT-5 right from the connected
   * card WITHOUT re-pasting the key (2026-06-28 — the connected state
   * had no model picker, so the only way to change models was to
   * Replace the whole key). Decrypts the stored key, re-tests it against
   * the NEW model (so a model the key can't access fails here, not later
   * at generate-time), then updates aiModel.
   */
  @Post('model')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setModel(@Request() req: any, @Body() body: { model?: string }) {
    const tenant = (await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { aiProvider: true, aiKeyEncrypted: true } as any,
    })) as any;
    if (!tenant?.aiKeyEncrypted || !tenant?.aiProvider) {
      throw new HttpException({ code: 'AI_KEY_NOT_CONFIGURED', message: 'Connect a provider key first, then you can switch models.' }, HttpStatus.BAD_REQUEST);
    }
    const provider = coerceProvider(tenant.aiProvider);
    if (!provider) {
      throw new HttpException({ code: 'AI_KEY_PROVIDER_UNRECOGNIZED', message: 'Stored AI provider is unrecognized — reconnect your key.' }, HttpStatus.BAD_REQUEST);
    }
    const requestedChoice = (body?.model || '').trim();
    if (!requestedChoice || !isKnownModel(provider, requestedChoice)) {
      throw new HttpException({ code: 'AI_KEY_MODEL_UNKNOWN', message: `Unknown model "${requestedChoice}" for provider ${provider}. Pick one from the list.` }, HttpStatus.BAD_REQUEST);
    }
    // Same tier rule as setKey: persist the tier, test the model serving it today.
    const tier = tierForSavedChoice(provider, requestedChoice);
    const requestedModel = healLegacyModelId(provider, tier);
    let apiKey: string;
    try {
      apiKey = openAiKey(tenant.aiKeyEncrypted);
    } catch {
      throw new HttpException({ code: 'AI_KEY_UNREADABLE', message: 'Your saved key could not be read (it may need re-entering). Use "Replace key".' }, HttpStatus.BAD_REQUEST);
    }
    // Re-test the STORED key against the NEW model — a model the key
    // lacks access to fails here with a clear message, not later when
    // an operator clicks "generate" and gets a confusing error.
    const testResult = await dispatchAi(provider, {
      apiKey,
      model: requestedModel,
      system: 'Reply with the single character "ok" and nothing else.',
      userPrompt: 'ping',
      maxTokens: 10,
    });
    if (testResult.errorStatus) {
      const providerLabel = provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Google';
      const quotaErr = mapProviderQuotaError(provider, testResult.errorStatus, testResult.errorBody);
      const detail = quotaErr
        ? quotaErr.message
        : testResult.errorStatus === 403
          ? `Your key doesn't have access to "${requestedModel}". Some models are gated by your ${providerLabel} plan — pick another.`
          : testResult.errorStatus === 404
            ? `"${requestedModel}" wasn't found on your ${providerLabel} account — try another model.`
            : testResult.errorStatus === 401
              ? `Your saved ${providerLabel} key was rejected — use "Replace key" to re-enter it.`
              : testResult.errorStatus === 429
                ? `Provider rate-limited the test — try again in a moment.`
                : `Provider rejected the request (${testResult.errorStatus}).`;
      // err-code sweep (task #57): same disambiguation as setKey() above —
      // quota code wins, else a status-shaped fallback code.
      const code = quotaErr
        ? quotaErr.code
        : testResult.errorStatus === 403
          ? 'AI_KEY_MODEL_FORBIDDEN'
          : testResult.errorStatus === 404
            ? 'AI_KEY_MODEL_NOT_FOUND'
            : testResult.errorStatus === 401
              ? 'AI_KEY_REJECTED'
              : testResult.errorStatus === 429
                ? 'AI_KEY_TEST_RATE_LIMITED'
                : 'AI_KEY_TEST_FAILED';
      await this.prisma.client.auditLog.create({
        data: {
          action: 'AI_KEY_TEST_FAILED',
          targetType: 'tenant',
          targetId: req.user.tenantId,
          tenantId: req.user.tenantId,
          userId: req.user.id,
          details: JSON.stringify({ provider, model: requestedModel, upstreamStatus: testResult.errorStatus, quotaError: !!quotaErr, via: 'model-switch' }),
        },
      }).catch(() => { /* audit best-effort */ });
      throw new HttpException({ code, message: detail }, HttpStatus.BAD_REQUEST);
    }
    await this.prisma.client.tenant.update({
      where: { id: req.user.tenantId },
      data: { aiModel: tier } as any,
    });
    await this.prisma.client.auditLog.create({
      data: {
        action: 'AI_KEY_MODEL_CHANGED',
        targetType: 'tenant',
        targetId: req.user.tenantId,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        details: JSON.stringify({ provider, tier, model: requestedModel }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, provider, model: requestedModel, tier };
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
