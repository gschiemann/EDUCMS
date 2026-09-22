/**
 * Audit P1-2 (2026-05-28) — AI alt-text generator.
 *
 * Pinned behaviors:
 *   1. OpenAI 200 reply → text returned, clipped to ≤160 chars, "image
 *      of" prefix stripped, surrounding quotes stripped.
 *   2. OpenAI 429 with `insufficient_quota` → AiAltTextQuotaError thrown
 *      with provider: 'openai'.
 *   3. Anthropic fallback used when OPENAI_API_KEY is missing but
 *      ANTHROPIC_API_KEY is set.
 *   4. Non-image mime (audio/video) → null + audit "skipped: not_an_image".
 *   5. No provider configured → null + audit "skipped: no_ai_provider_configured".
 *   6. Long output (>160 chars) → clipped to 159 chars + ellipsis.
 *
 * 2026-05-29 audit §3/§4 additions:
 *   7. Google/Gemini BYOK → vision alt-text works: request hits
 *      :generateContent with the key in the x-goog-api-key HEADER (not
 *      the URL) and an inlineData image part; caption parsed from
 *      candidates[0].content.parts; provider='google', model=tenant's.
 *   8. A BYOK key for a provider with no vision branch → null + audit
 *      "skipped: provider_unsupported_for_altext" (NOT the misleading
 *      "no_ai_provider_configured").
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AiAllowanceService } from './ai-allowance.service';
import { AiUsageMeterService } from './ai-usage-meter.service';
import { AiAltTextService, AiAltTextQuotaError, parseDesignReferenceReply } from './ai-alt-text.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { sealAiKey } from './ai-key-cipher';

// Mock global fetch — every provider call goes through it.
const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;
// AbortSignal.timeout exists in Node 20+ (our runtime). The mock fetch
// ignores the signal — tests resolve before the timeout would fire.

// In-memory Prisma stub. Each spec re-initializes the maps so calls
// don't leak across cases.
const tenantsById = new Map<string, any>();
const auditRows: Array<any> = [];

const prismaMock: any = {
  client: {
    tenant: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = tenantsById.get(where.id);
        if (!row) return null;
        if (!select) return row;
        const out: any = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = row[k];
        }
        return out;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const cur = tenantsById.get(where.id) || {};
        if (data?.aiPlatformUsageCount?.increment) {
          cur.aiPlatformUsageCount = (cur.aiPlatformUsageCount ?? 0) + data.aiPlatformUsageCount.increment;
        } else {
          Object.assign(cur, data);
        }
        tenantsById.set(where.id, cur);
        return cur;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
  },
};

describe('AiAltTextService (P1-2)', () => {
  let service: AiAltTextService;

  beforeEach(async () => {
    // Reset every spec — env vars, mocks, in-memory tables.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    fetchMock.mockReset();
    tenantsById.set('tenant-1', { id: 'tenant-1', aiProvider: null, aiKeyEncrypted: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAltTextService,
        { provide: PrismaService, useValue: prismaMock },
        // RedisService stub — publisher:null makes the shared 30/hr cap
        // fail-open (skipped), so these specs exercise the provider
        // paths exactly as before the cap was added.
        { provide: RedisService, useValue: { publisher: null } },
      ],
    }).compile();
    service = module.get(AiAltTextService);
  });

  it('returns a generated alt-text under 125 chars on OpenAI 200', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'A golden lion mascot standing on a brick column.' } }],
      }),
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      assetId: 'asset-1',
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      contextHint: 'lions-mascot.jpg',
    });

    expect(result).not.toBeNull();
    expect(result!.altText).toBe('A golden lion mascot standing on a brick column.');
    expect(result!.altText.length).toBeLessThanOrEqual(125);
    expect(result!.provider).toBe('openai');
    // 2026-09-22 — the provider's Standard-tier vision model, resolved live from the catalog.
    expect(result!.model).toBe('gpt-6-luna');
    // …with that model's request rules: a reasoning model gets max_completion_tokens (+ headroom),
    // the effort knob, and no temperature.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe('gpt-6-luna');
    expect(sent.max_completion_tokens).toBe(300 + 12000);
    expect(sent.reasoning_effort).toBe('low');
    expect(sent.max_tokens).toBeUndefined();
    expect(sent.temperature).toBeUndefined();

    // Audit row was written.
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_GENERATED');
    expect(audit).toBeDefined();
    expect(audit.tenantId).toBe('tenant-1');
    expect(audit.targetId).toBe('asset-1');
  });

  it('strips "image of " prefix and surrounding quotes', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '"Image of a sunset over the ocean."' } }],
      }),
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/png',
    });

    expect(result!.altText).toBe('a sunset over the ocean.');
  });

  it('clips alt-text longer than 160 chars to 159 + ellipsis', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const longText = 'x'.repeat(300);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: longText } }] }),
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });

    expect(result!.altText.length).toBe(160);
    expect(result!.altText.endsWith('…')).toBe(true);
  });

  it('throws AiAltTextQuotaError on OpenAI 429 insufficient_quota', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({ error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } }),
    });

    await expect(
      service.generateImageAltText({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(AiAltTextQuotaError);

    // The quota path SHOULD still write an audit row so a SUPER_ADMIN
    // can attribute the failure.
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_FAILED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).errorCode).toBe('AI_QUOTA_EXHAUSTED');
  });

  // P1-7 (2026-05-28 audit) — alt-text quota detection must use the
  // SHARED mapProviderQuotaError, so out-of-credit disambiguates the
  // SAME way as the text-gen path. Anthropic out-of-credit is HTTP 400
  // + credit_balance_too_low (or 402); the OLD forked logic here only
  // matched 402 / 400, but the win is it now carries the SAME
  // AI_PROVIDER_OUT_OF_CREDIT code text-gen uses.
  it('throws AiAltTextQuotaError (out-of-credit) on Anthropic 400 credit_balance_too_low — shared helper', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Claude API.' } }),
    });

    let caught: any;
    await service
      .generateImageAltText({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/jpeg',
      })
      .catch((e) => { caught = e; });

    expect(caught).toBeInstanceOf(AiAltTextQuotaError);
    expect(caught.provider).toBe('anthropic');
    // Same disambiguation token as the text-gen path (ai.service.ts).
    expect(caught.code).toBe('AI_PROVIDER_OUT_OF_CREDIT');
    // And the failure is still audited for SUPER_ADMIN attribution.
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_FAILED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).errorCode).toBe('AI_QUOTA_EXHAUSTED');
  });

  // P1-7 — Anthropic 402 (the rarer out-of-credit form) must ALSO map
  // to the quota error via the shared helper. The old forked logic
  // handled this, but pin it so a future refactor can't drop it.
  it('throws AiAltTextQuotaError on Anthropic 402 — shared helper', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: { type: 'payment_required' } }),
    });

    await expect(
      service.generateImageAltText({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(AiAltTextQuotaError);
  });

  // P1-7 — a PURE per-minute rate-limit (helper returns null) must NOT
  // throw the quota error; it returns null like any other generic
  // failure, EXACTLY as the text-gen path falls through on null. This
  // is the behavior the old forked logic got right for Anthropic only
  // by accident (it had no 429 branch); now it's the documented
  // shared contract.
  it('returns null (not quota error) on Anthropic 429 rate-limit — shared helper null path', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }),
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_FAILED');
    expect(audit).toBeDefined();
    // Not a quota failure — generic error path.
    expect(JSON.parse(audit.details).errorCode).toBeUndefined();
  });

  it('falls back to Anthropic when OPENAI_API_KEY is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toContain('api.anthropic.com');
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ text: 'A red brick schoolhouse.' }] }),
      };
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/png',
    });

    expect(result).not.toBeNull();
    expect(result!.provider).toBe('anthropic');
    expect(result!.model).toBe('claude-haiku-4-5');
    expect(result!.altText).toBe('A red brick schoolhouse.');
  });

  it('returns null when no provider is configured', async () => {
    // No OPENAI / ANTHROPIC env vars; tenant has no BYOK key.
    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).reason).toBe('no_ai_provider_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for non-image mime types', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'video/mp4',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).reason).toBe('not_an_image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips when the organisation\'s included AI is used up (no BYOK)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAltTextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: { publisher: null } },
        {
          provide: AiAllowanceService,
          useValue: { snapshot: jest.fn(async () => ({ usedMicros: 5_000_000, includedMicros: 5_000_000 })) },
        },
      ],
    }).compile();
    service = module.get(AiAltTextService);

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).reason).toBe('platform_cap_exhausted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (not throw) on a generic provider 500', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_FAILED');
    expect(audit).toBeDefined();
  });

  it('writes the call to the usage ledger at the tokens the provider reported', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const record = jest.fn(async () => 0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAltTextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: { publisher: null } },
        { provide: AiUsageMeterService, useValue: { record } },
      ],
    }).compile();
    service = module.get(AiAltTextService);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'A photo.' } }], usage: { prompt_tokens: 800, completion_tokens: 40 } }),
    });

    await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1', provider: 'openai', model: 'gpt-6-luna', source: 'platform', feature: 'alt-text',
        usage: { inputTokens: 800, outputTokens: 40 },
      }),
    );
  });

  // ── 2026-05-29 audit §3/§4 — Google/Gemini vision alt-text ──────────

  it('uses Google/Gemini vision for a Google-BYOK tenant — valid request shape + caption parse', async () => {
    // Tenant has a Google BYOK key + a chosen gemini model. NO platform
    // env keys — proves the Google branch is taken via BYOK, not a
    // platform OpenAI/Anthropic fallback.
    tenantsById.set('tenant-1', {
      id: 'tenant-1',
      aiProvider: 'google',
      aiKeyEncrypted: sealAiKey('AIzaTESTKEY1234567890'),
      aiModel: 'gemini-2.5-flash',
    });

    let capturedUrl = '';
    let capturedInit: any = null;
    fetchMock.mockImplementation(async (url: string, init: any) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'A soccer team celebrating a goal on the pitch.' }] } }],
        }),
      };
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      assetId: 'asset-g',
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      contextHint: 'goal-celebration.jpg',
    });

    // Caption parsed + provider/model correct. The tenant's saved gemini-2.5 choice is NOT sent:
    // a caption is a fast job on Google's live Standard-tier vision model (2026-09-22).
    expect(result).not.toBeNull();
    expect(result!.altText).toBe('A soccer team celebrating a goal on the pitch.');
    expect(result!.provider).toBe('google');
    expect(result!.model).toBe('gemini-3.5-flash-lite');

    // Request shape: model on the :generateContent URL, key OFF the URL.
    expect(capturedUrl).toContain('generativelanguage.googleapis.com');
    expect(capturedUrl).toContain('gemini-3.5-flash-lite:generateContent');
    expect(capturedUrl).not.toMatch(/[?&]key=/);

    // Key rides in the x-goog-api-key HEADER.
    expect(capturedInit.headers['x-goog-api-key']).toBe('AIzaTESTKEY1234567890');
    expect(capturedInit.headers.authorization).toBeUndefined();

    // Body carries an inlineData image part with the base64 + mime, plus
    // a systemInstruction (the alt-text prompt).
    const body = JSON.parse(capturedInit.body);
    const parts = body.contents[0].parts;
    const inline = parts.find((p: any) => p.inlineData);
    expect(inline).toBeDefined();
    expect(inline.inlineData.mimeType).toBe('image/jpeg');
    expect(typeof inline.inlineData.data).toBe('string');
    expect(inline.inlineData.data.length).toBeGreaterThan(0);
    expect(body.systemInstruction).toBeDefined();
    // Gemini 3 rules: thinkingLevel, no temperature, headroom for thought tokens.
    expect(body.generationConfig).toEqual({ maxOutputTokens: 300 + 12000, thinkingConfig: { thinkingLevel: 'low' } });

    // Audit row written with provider=google.
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_GENERATED');
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details).provider).toBe('google');
  });

  it('OUR key out of credit → the operator sees "temporarily unavailable", never the vendor\'s add-credits steps', async () => {
    process.env.OPENAI_API_KEY = 'sk-platform';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } }),
    });
    const caught = await service
      .generateImageAltText({ tenantId: 'tenant-1', imageBuffer: Buffer.from([0]), mimeType: 'image/jpeg' })
      .catch((e) => e);
    expect(caught).toBeInstanceOf(AiAltTextQuotaError);
    expect(caught.message).toBe('AI is temporarily unavailable. Try again in a few minutes.');
    expect(caught.message).not.toMatch(/credit|billing|ChatGPT/i);
  });

  it('maps Google 429 RESOURCE_EXHAUSTED to AiAltTextQuotaError via the shared helper', async () => {
    tenantsById.set('tenant-1', {
      id: 'tenant-1',
      aiProvider: 'google',
      aiKeyEncrypted: sealAiKey('AIzaTESTKEY1234567890'),
      aiModel: 'gemini-2.5-flash',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }),
    });

    let caught: any;
    await service
      .generateImageAltText({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/png',
      })
      .catch((e) => { caught = e; });

    expect(caught).toBeInstanceOf(AiAltTextQuotaError);
    expect(caught.provider).toBe('google');
    expect(caught.code).toBe('AI_PROVIDER_OUT_OF_CREDIT');
  });

  // §3 honesty fix — a BYOK key IS configured but for a provider with no
  // vision branch. The skip reason must say so, NOT lie
  // "no_ai_provider_configured".
  it('emits provider_unsupported_for_altext (not "no provider") when a configured provider has no vision branch', async () => {
    // 'azure' is not a recognized vision provider. The tenant clearly
    // HAS a key — the old code wrongly skipped with
    // no_ai_provider_configured. Prove the honest reason now.
    tenantsById.set('tenant-1', {
      id: 'tenant-1',
      aiProvider: 'azure',
      aiKeyEncrypted: sealAiKey('some-azure-key-1234567890'),
      aiModel: '',
    });

    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });

    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
    expect(audit).toBeDefined();
    const details = JSON.parse(audit.details);
    expect(details.reason).toBe('provider_unsupported_for_altext');
    expect(details.reason).not.toBe('no_ai_provider_configured');
    expect(details.provider).toBe('azure');
    // No upstream call made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Guard the "truly no key" path still reports the original reason.
  it('still reports no_ai_provider_configured when there is genuinely no key anywhere', async () => {
    // tenant-1 from beforeEach has aiProvider:null, aiKeyEncrypted:null;
    // no platform env keys set.
    const result = await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });
    expect(result).toBeNull();
    const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
    expect(JSON.parse(audit.details).reason).toBe('no_ai_provider_configured');
  });

  // ── S5 economic-model hard stop (2026-08-03) ─────────────────────────────
  // `AI_KEY_UNREADABLE` reached every spend path in AiService on 2026-07-16
  // but MISSED alt-text, which kept a pre-hardening copy of key resolution:
  // on a decrypt failure it warned and fell through to the platform key —
  // silently billing VenueOS's Tier-1 budget for a tenant's Tier-2 action,
  // invisibly, because alt-text is fire-and-forget. Both vision entrypoints
  // must now hard-stop.
  describe('S5: configured-but-unreadable BYOK key never spends the platform key', () => {
    beforeEach(() => {
      // Platform keys ARE present — this is the exact condition under which
      // the old fall-through silently spent Tier-1 budget.
      process.env.OPENAI_API_KEY = 'sk-platform';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
      // A key blob that `openAiKey()` cannot decrypt (not sealed output).
      tenantsById.set('tenant-1', {
        id: 'tenant-1',
        aiProvider: 'openai',
        aiKeyEncrypted: 'not-a-valid-sealed-blob',
        aiModel: '',
      });
    });

    it('generateImageAltText → null + ai_key_unreadable audit, NO provider call', async () => {
      const result = await service.generateImageAltText({
        tenantId: 'tenant-1',
        assetId: 'asset-9',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/jpeg',
      });

      expect(result).toBeNull();
      // The load-bearing assertion: no upstream call, so no platform spend.
      expect(fetchMock).not.toHaveBeenCalled();

      const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_SKIPPED');
      expect(audit).toBeDefined();
      const details = JSON.parse(audit.details);
      expect(details.reason).toBe('ai_key_unreadable');
      expect(details.code).toBe('AI_KEY_UNREADABLE');
      // Must NOT masquerade as either of the pre-existing skip reasons.
      expect(details.reason).not.toBe('no_ai_provider_configured');
      expect(details.reason).not.toBe('provider_unsupported_for_altext');
    });

    it('analyzeDesignReference → null + ai_key_unreadable audit, NO provider call', async () => {
      const result = await service.analyzeDesignReference({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/png',
      });

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      const audit = auditRows.find((a) => a.action === 'AI_DESIGN_REFERENCE_SKIPPED');
      expect(audit).toBeDefined();
      const details = JSON.parse(audit.details);
      expect(details.reason).toBe('ai_key_unreadable');
      expect(details.code).toBe('AI_KEY_UNREADABLE');
    });

    it('a tenant that NEVER configured a key still uses the platform key (no regression)', async () => {
      tenantsById.set('tenant-1', { id: 'tenant-1', aiProvider: null, aiKeyEncrypted: null });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'A red barn at dusk.' } }] }),
      });

      const result = await service.generateImageAltText({
        tenantId: 'tenant-1',
        imageBuffer: Buffer.from([0]),
        mimeType: 'image/jpeg',
      });

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('openai');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const audit = auditRows.find((a) => a.action === 'AI_ALT_TEXT_GENERATED');
      expect(JSON.parse(audit.details).source).toBe('platform');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A PHOTO OF A MENU (2026-09-22). supertacomex.com publishes no readable menu —
// the prices live inside Toast's ordering app — so the Concierge now asks the
// operator to snap their printed menu. The same vision call that reads a
// "look" reads the items, and hands them back as a real menu.
// ───────────────────────────────────────────────────────────────────────────
describe('AiAltTextService — a photo of a MENU is read into items (2026-09-22)', () => {
  let service: AiAltTextService;
  const reply = {
    summary: 'A warm, hand-painted taqueria menu board with chalk-style lettering.',
    palette: ['#1f1a17', '#e2452a', '#f5c518'],
    menu: { sections: [
      { name: 'Burritos', items: [{ name: 'Super Burrito', price: '$12.99' }, { name: 'Bean & Cheese', price: '$7.50' }] },
      { name: 'Tacos', items: [{ name: 'Al Pastor', price: '$3.25' }] },
    ] },
  };

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    process.env.OPENAI_API_KEY = 'sk-test';
    tenantsById.clear();
    auditRows.length = 0;
    fetchMock.mockReset();
    tenantsById.set('tenant-1', { id: 'tenant-1', aiProvider: null, aiKeyEncrypted: null });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAltTextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: { publisher: null } },
      ],
    }).compile();
    service = module.get(AiAltTextService);
  });

  it('returns the menu alongside the style read, normalised, and asks for room to write it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
    });
    const out = await service.analyzeDesignReference({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
    });
    expect(out).not.toBeNull();
    expect(out!.summary).toContain('taqueria');
    expect(out!.menu).toEqual({
      sections: [
        { name: 'Burritos', items: [{ name: 'Super Burrito', price: '$12.99' }, { name: 'Bean & Cheese', price: '$7.50' }] },
        { name: 'Tacos', items: [{ name: 'Al Pastor', price: '$3.25' }] },
      ],
      itemCount: 3,
      source: { url: 'uploaded photo', method: 'photo' },
    });
    // The request itself: the menu instructions are in the system prompt and
    // the output ceiling is big enough for a full menu.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // room for the whole menu (visible 3000) + the reasoning headroom the Standard model needs
    expect(body.max_completion_tokens).toBe(3000 + 12000);
    expect(JSON.stringify(body.messages)).toContain('copy every item name and price EXACTLY as printed');
    const audit = auditRows.find((a) => a.action === 'AI_DESIGN_REFERENCE_ANALYZED');
    expect(JSON.parse(audit.details).menuItems).toBe(3);
  });

  it('a picture that is not a menu carries no menu — the style read is unchanged', async () => {
    const { menu: _dropped, ...styleOnly } = reply;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(styleOnly) } }] }),
    });
    const out = await service.analyzeDesignReference({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
    });
    expect(out!.menu).toBeUndefined();
    expect(out!.palette).toEqual(['#1f1a17', '#e2452a', '#f5c518']);
  });
});

describe('parseDesignReferenceReply — the raw menu rides along, untouched', () => {
  it('hands back rawMenu only when the reply had one', () => {
    expect(parseDesignReferenceReply(JSON.stringify({ summary: 'x', palette: [], menu: { sections: [] } })).rawMenu).toEqual({ sections: [] });
    expect(parseDesignReferenceReply(JSON.stringify({ summary: 'x', palette: [] })).rawMenu).toBeUndefined();
    expect(parseDesignReferenceReply('not json at all').rawMenu).toBeUndefined();
  });
});
