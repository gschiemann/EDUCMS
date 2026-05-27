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
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AiAltTextService, AiAltTextQuotaError } from './ai-alt-text.service';
import { PrismaService } from '../prisma/prisma.service';

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
    expect(result!.model).toBe('gpt-4o-mini');

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
    expect(result!.model).toBe('claude-3-5-haiku-20241022');
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

  it('skips when platform monthly cap is exhausted (no BYOK)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_FREE_TIER_CAP = '10';
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    tenantsById.set('tenant-1', {
      id: 'tenant-1',
      aiProvider: null,
      aiKeyEncrypted: null,
      aiPlatformUsageMonth: monthKey,
      aiPlatformUsageCount: 10,
    });

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

  it('bumps platform usage counter on successful platform-paid call', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'A photo.' } }] }),
    });

    await service.generateImageAltText({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0]),
      mimeType: 'image/jpeg',
    });

    const tenant = tenantsById.get('tenant-1');
    expect(tenant.aiPlatformUsageCount).toBe(1);
  });
});
