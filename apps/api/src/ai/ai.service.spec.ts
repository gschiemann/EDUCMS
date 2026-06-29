/**
 * AiService — P1-14 (2026-05-28 audit) Redis-backed rate-limit caps.
 *
 * The two per-tenant hourly caps (30 successful generations/hr, 200
 * failures/hr) moved from in-memory Maps to Redis sorted sets so they
 * hold ACROSS replicas. These specs pin:
 *   1. The success cap (30/hr) READS Redis (zremrangebyscore + zcard)
 *      on every generate, and WRITES Redis (zadd + pexpire) only AFTER
 *      a usable result — never on a failed call.
 *   2. When Redis reports the window is full, generate() throws the
 *      hourly-cap error WITHOUT calling the provider.
 *   3. FAIL-OPEN: when the Redis publisher is null (Redis down), the
 *      cap is skipped — a generation still succeeds. Documented
 *      degradation: a blip never blocks a paying customer; the durable
 *      monthly platform cap (Postgres) is the real spend ceiling.
 *   4. The failure cap (200/hr) is checked from Redis at the door and
 *      a failure is recorded to Redis in the catch.
 *
 * `dispatchAi` is mocked so no real provider call fires; the real
 * `mapProviderQuotaError` / `coerceProvider` are preserved.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AiService, sanitizeRewriteText, validateChatEditDiff, resolveChatColor, brandVoiceClause, prependVoices, parseArtDirectorSpec, signageCandidatePlan } from './ai.service';
import { ARCHETYPE_IDS } from '@cms/signage-design';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

// Mock ONLY dispatchAi; keep the rest of ai-providers real (the service
// imports mapProviderQuotaError + coerceProvider from the same module).
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
import { dispatchAi } from './ai-providers';
import { resolveAiHourlyCap } from './ai-hourly-cap';
const dispatchMock = dispatchAi as unknown as jest.Mock;

// ── In-memory Prisma stub ───────────────────────────────────────────
const tenantsById = new Map<string, any>();
const brandingByTenant = new Map<string, any>(); // Slice 1b — brand voice rows
const auditRows: Array<any> = [];
const prismaMock: any = {
  client: {
    tenant: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const row = tenantsById.get(where.id);
        if (!row) return null;
        if (!select) return row;
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
        return out;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const cur = tenantsById.get(where.id) || { id: where.id };
        if (data?.aiPlatformUsageCount?.increment) {
          cur.aiPlatformUsageCount = (cur.aiPlatformUsageCount ?? 0) + data.aiPlatformUsageCount.increment;
        } else {
          Object.assign(cur, data);
        }
        tenantsById.set(where.id, cur);
        return cur;
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
    tenantBranding: {
      findUnique: jest.fn(async ({ where }: any) => brandingByTenant.get(where.tenantId) ?? null),
    },
    // 2026-06-26 — AI image generation persists the decoded image as an
    // Asset row. Stub returns a deterministic id so the test can assert
    // the controller-facing shape + the AuditLog targetId.
    asset: {
      create: jest.fn(async ({ data }: any) => ({ id: 'asset_generated_1', ...data })),
    },
  },
};

// ── Fake ioredis sorted-set store ───────────────────────────────────
// Minimal in-memory model of the 4 commands the rate limiter uses:
//   zremrangebyscore(key, min, max) — drop members whose score ∈ [min,max]
//   zcard(key) — count members
//   zadd(key, score, member) — add (member unique)
//   pexpire(key, ms) — no-op for the test (we don't simulate TTL)
function makeFakeRedisClient() {
  const sets = new Map<string, Map<string, number>>(); // key → (member → score)
  return {
    sets,
    zremrangebyscore: jest.fn(async (key: string, min: number, max: number) => {
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const [member, score] of [...s.entries()]) {
        if (score >= min && score <= max) { s.delete(member); removed += 1; }
      }
      return removed;
    }),
    zcard: jest.fn(async (key: string) => sets.get(key)?.size ?? 0),
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      let s = sets.get(key);
      if (!s) { s = new Map(); sets.set(key, s); }
      const isNew = !s.has(member);
      s.set(member, score);
      return isNew ? 1 : 0;
    }),
    pexpire: jest.fn(async () => 1),
  };
}

// 2026-06-26 — storage stub for AI image generation. `upload` returns a
// public URL; `delete` is a no-op rollback. Recreated per buildService so
// each test gets fresh call counts.
function makeStorageMock() {
  return {
    upload: jest.fn(async (path: string, _buf: any, _ct: string) =>
      `https://example.supabase.co/storage/v1/object/public/assets/${path}`),
    delete: jest.fn(async () => undefined),
  };
}

function buildService(publisher: any, storage?: any, stock?: any): { service: AiService; storage: any; stock: any } {
  const redisMock = { publisher } as unknown as RedisService;
  const storageMock = storage ?? makeStorageMock();
  // 2026-06-28 — AiService now takes AiAltTextService (Signage Concierge image
  // references). None of the suites below exercise the concierge image path, so
  // a thin stub keeps construction type-correct without a Nest container.
  const altTextMock = {
    analyzeDesignReference: jest.fn(async () => null),
  } as any;
  // 2026-06-28 — IMAGERY wave. AiService now also takes StockImageService. Most
  // suites don't exercise the stock path (no PEXELS_API_KEY in CI), so the
  // DEFAULT stub reports "not configured" → generation rides the gradient,
  // identical to the no-key behaviour. The auto-photo suite passes its own.
  const stockMock = stock ?? {
    isConfigured: jest.fn(() => false),
    search: jest.fn(async () => null),
  } as any;
  // Synchronous construct — no Nest container needed, but use it for parity.
  const service = new AiService(prismaMock as PrismaService, redisMock, storageMock as any, altTextMock, stockMock);
  return { service, storage: storageMock, stock: stockMock };
}

describe('AiService — P1-14 Redis-backed rate limits', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  const okGenerate = () =>
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Spring sale starts today.' }]) });

  it('reads the hourly window from Redis (zremrangebyscore + zcard) on every generate', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    okGenerate();
    const { service } = buildService(fake);

    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });

    // The success window key is read (prune + count) BEFORE dispatch.
    expect(fake.zremrangebyscore).toHaveBeenCalledWith('ai:rl:gen:t1', 0, expect.any(Number));
    expect(fake.zcard).toHaveBeenCalledWith('ai:rl:gen:t1');
    // And recorded to Redis only AFTER a usable result.
    expect(fake.zadd).toHaveBeenCalledWith('ai:rl:gen:t1', expect.any(Number), expect.any(String));
    expect(fake.pexpire).toHaveBeenCalledWith('ai:rl:gen:t1', expect.any(Number));
  });

  it('does NOT record a slot in Redis when the generation fails (leak-fix preserved)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    // Provider returns a non-2xx → generate throws, no slot consumed.
    dispatchMock.mockResolvedValue({ raw: '', errorStatus: 500, errorBody: 'boom' });
    const { service } = buildService(fake);

    await expect(
      service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' }),
    ).rejects.toBeTruthy();

    // No success-slot zadd — failed call must not burn the 30/hr cap.
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(0);
    // But a FAILURE slot WAS recorded for the 200/hr abuse cap.
    const failAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:fail:t1');
    expect(failAdds.length).toBe(1);
  });

  it('throws the hourly cap error from the Redis count WITHOUT calling the provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    // Pre-fill the success window to the hourly cap (env-overridable; default
    // 120 since 2026-06-28 — fill to the resolved cap so this stays correct
    // regardless of the default).
    const now = Date.now();
    const cap = resolveAiHourlyCap();
    const win = new Map<string, number>();
    for (let i = 0; i < cap; i++) win.set(`m${i}`, now - 1000);
    fake.sets.set('ai:rl:gen:t1', win);
    const { service } = buildService(fake);

    await expect(
      service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' }),
    ).rejects.toThrow(/hourly AI cap/i);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('FAILS OPEN when Redis is down (publisher null) — generation still succeeds, cap skipped', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    okGenerate();
    const { service } = buildService(null); // no Redis client

    const res = await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    expect(res.options.length).toBeGreaterThan(0);
    // Provider WAS called (the cap didn't block) — documented fail-open.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces the 200/hr failure cap from Redis at the door', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    // Pre-fill the FAILURE window to the 200 cap.
    const now = Date.now();
    const win = new Map<string, number>();
    for (let i = 0; i < 200; i++) win.set(`f${i}`, now - 1000);
    fake.sets.set('ai:rl:fail:t1', win);
    const { service } = buildService(fake);

    await expect(
      service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_FAILURE_CAP_REACHED' }) });
    // Failure cap is checked before any provider work.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('bumps the durable monthly platform counter (Postgres) on a successful platform call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    okGenerate();
    const { service } = buildService(fake);

    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    // The monthly cap is unaffected by P1-14 — still Postgres-backed.
    expect(tenantsById.get('t1').aiPlatformUsageCount).toBe(1);
  });

  // 2026-06-09 Fable pre-launch audit — regression pin for the AI-P0-1
  // dead-code bug. The structured 402 out-of-credit envelope is thrown
  // INSIDE the dispatch try, but the catch only re-threw
  // ServiceUnavailableException, so the 402 was silently downgraded to a
  // generic 503 "AI service unreachable" — an operator out of BYOK credit
  // saw "outage" instead of "add credit", and the shipped AI-P0-1 fix was
  // dead code. This pins that the 402 + code now propagates from generate().
  // Pre-fix this test fails (503, message "unreachable", no code).
  it('surfaces provider out-of-credit as a 402 AI_PROVIDER_OUT_OF_CREDIT, not a generic 503', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    // Anthropic out-of-credit signature: HTTP 400 + "credit balance is too low".
    dispatchMock.mockResolvedValue({
      raw: '',
      errorStatus: 400,
      errorBody:
        '{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}',
    });
    const { service } = buildService(fake);

    await expect(
      service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' }),
    ).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({
        code: 'AI_PROVIDER_OUT_OF_CREDIT',
        provider: 'anthropic',
      }),
    });
  });
});

// ── Slice 1c (2026-06-16) — 3-candidate "pick-a-winner" generation ──
// generateTouchTemplateCandidates fans out N drafts with diversified
// design-direction seeds, returns sanitized drafts (NOT persisted), and
// records spend PER SUCCESSFUL candidate (honest 3-tier accounting). One
// bad draft must not sink the batch; an all-fail surfaces a real error.
describe('AiService — Slice 1c 3-candidate generation', () => {
  // A minimal valid touch-template JSON (≥1 sanitizable zone).
  const tpl = () =>
    JSON.stringify({
      name: 'Lobby kiosk',
      zones: [
        { widgetType: 'ANNOUNCEMENT', x: 10, y: 10, width: 80, height: 30, defaultConfig: { message: 'Welcome' } },
        { widgetType: 'TEXT', x: 10, y: 50, width: 40, height: 20, defaultConfig: { content: 'Sign in' }, touchAction: { type: 'goto-scene', target: 'main' } },
      ],
    });

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('fans out 3 drafts and records one slot + one monthly credit PER successful candidate', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: tpl() });
    const { service } = buildService(fake);

    const res = await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby check-in kiosk' });

    expect(res.candidates.length).toBe(3);
    expect(dispatchMock).toHaveBeenCalledTimes(3); // one provider call per candidate
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(3); // honest hourly accounting
    expect(tenantsById.get('t1').aiPlatformUsageCount).toBe(3); // 3 monthly credits
  });

  it('keeps the successful drafts when one generation fails (batch not sunk)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock
      .mockResolvedValueOnce({ raw: tpl() })
      .mockResolvedValueOnce({ raw: '', errorStatus: 500, errorBody: 'boom' })
      .mockResolvedValueOnce({ raw: tpl() });
    const { service } = buildService(fake);

    const res = await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby kiosk' });

    expect(res.candidates.length).toBe(2); // 2 of 3 survived
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(2); // only the 2 successes burned a slot
  });

  it('uses the passive-signage system prompt when interactive=false (serves the non-touch maker)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: tpl() });
    const { service } = buildService(fake);

    await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby board', interactive: false });

    // dispatchAi(provider, { system, ... }) — system is the 2nd arg.
    const systems = dispatchMock.mock.calls.map((c) => String(c[1].system));
    expect(systems.length).toBe(3);
    expect(systems.every((s) => /NON-interactive/i.test(s))).toBe(true);
  });

  it('uses the interactive touch system prompt by default', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: tpl() });
    const { service } = buildService(fake);

    await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby kiosk' });

    const systems = dispatchMock.mock.calls.map((c) => String(c[1].system));
    expect(systems.every((s) => /interactive touch-screen templates/i.test(s))).toBe(true);
  });

  it('throws (surfacing the provider error) when EVERY candidate fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: '', errorStatus: 500, errorBody: 'boom' });
    const { service } = buildService(fake);

    await expect(
      service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'x' }),
    ).rejects.toBeTruthy();
    // No usable candidate → no success slot burned.
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(0);
  });
});

// ── Slice 1d (2026-06-16) — inline text rewrite ──
// rewriteText transforms ONE widget field's text and returns 1-3 options
// (preview-then-apply). Pins: field-map allow-list, op-specific required
// params, density rule, spend accounting, and output sanitization (the
// security spine — no HTML/URL/script ever reaches the operator).
describe('AiService — Slice 1d inline rewrite', () => {
  beforeEach(() => {
    delete process.env.AI_FREE_TIER_CAP;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('sanitizeRewriteText: plain strips ALL tags + URLs + script blocks', () => {
    expect(sanitizeRewriteText('<script>bad()</script>Hello <b>hi</b> http://evil.com', 'plain')).toBe('Hello hi');
    expect(sanitizeRewriteText('click javascript:alert(1) now', 'plain')).not.toContain('javascript:');
  });

  it('sanitizeRewriteText: rich keeps a whitelist + drops attributes', () => {
    expect(sanitizeRewriteText('Hello <b>hi</b> <span onclick="x()">y</span>', 'rich')).toBe('Hello <b>hi</b> <span>y</span>');
    expect(sanitizeRewriteText('<div class="evil">x</div>', 'rich')).toBe('x'); // div not whitelisted
  });

  it('rejects empty text', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.rewriteText({ tenantId: 't1', widgetType: 'TEXT', fieldKey: 'content', currentText: '   ', op: 'rewrite' }),
    ).rejects.toBeTruthy();
  });

  it('rejects a non-text widget field with FIELD_NOT_TEXT_EDITABLE', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.rewriteText({ tenantId: 't1', widgetType: 'CLOCK', fieldKey: 'content', currentText: 'hi', op: 'rewrite' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FIELD_NOT_TEXT_EDITABLE' }) });
  });

  it('rejects a list (TICKER) field — excluded from inline-rewrite v1', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.rewriteText({ tenantId: 't1', widgetType: 'TICKER', fieldKey: 'messages', currentText: 'hi', op: 'rewrite' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FIELD_NOT_TEXT_EDITABLE' }) });
  });

  it('translate without a target language → 400', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.rewriteText({ tenantId: 't1', widgetType: 'TEXT', fieldKey: 'content', currentText: 'hi', op: 'translate' }),
    ).rejects.toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('density rule: short input → up to 3 options, long input → 1', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'a' }, { text: 'b' }, { text: 'c' }]) });
    const { service } = buildService(makeFakeRedisClient());
    const short = await service.rewriteText({ tenantId: 't1', widgetType: 'TEXT', fieldKey: 'content', currentText: 'short text', op: 'rewrite' });
    expect(short.options.length).toBe(3);
    const long = await service.rewriteText({ tenantId: 't1', widgetType: 'TEXT', fieldKey: 'content', currentText: 'x'.repeat(160), op: 'rewrite' });
    expect(long.options.length).toBe(1);
  });

  it('records one slot + bumps one platform credit on success', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Game night!' }]) });
    const fake = makeFakeRedisClient();
    const { service } = buildService(fake);
    await service.rewriteText({ tenantId: 't1', widgetType: 'ANNOUNCEMENT', fieldKey: 'message', currentText: 'game', op: 'punch' });
    const adds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(adds.length).toBe(1);
    expect(tenantsById.get('t1').aiPlatformUsageCount).toBe(1);
  });

  it('sanitizes model option text (strips script + URL, keeps the copy)', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: '<script>x()</script>Sale today http://evil.com' }]) });
    const { service } = buildService(makeFakeRedisClient());
    const r = await service.rewriteText({ tenantId: 't1', widgetType: 'TEXT', fieldKey: 'content', currentText: 'sale', op: 'rewrite' });
    expect(r.options[0].text).not.toContain('<');
    expect(r.options[0].text).not.toContain('http');
    expect(r.options[0].text).toContain('Sale today');
  });
});

// ── Slice 2a (2026-06-16) — chat-to-edit ──
// resolveChatEdit turns NL → a server-VALIDATED field-mutation diff. The
// load-bearing tests are on validateChatEditDiff (the untrusted-input spine):
// drop unknown zoneIds, clamp numerics, resolve brand tokens, reject CSS
// injection. Plus end-to-end (cap/spend, 422 when nothing maps).
describe('AiService — Slice 2a chat-to-edit', () => {
  beforeEach(() => {
    delete process.env.AI_FREE_TIER_CAP;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('resolveChatColor: brand keywords → var() tokens; hex passes; junk → null', () => {
    expect(resolveChatColor('brand red')?.value).toBe('var(--brand-primary)');
    expect(resolveChatColor('accent')?.value).toBe('var(--brand-accent)');
    expect(resolveChatColor('#0A2540')?.value).toBe('#0a2540');
    expect(resolveChatColor('navy')).toBeNull(); // model must convert names to hex
    expect(resolveChatColor('red; background:url(http://evil)')).toBeNull(); // CSS injection
  });

  it('validateChatEditDiff: clamps size, resolves brand color, sanitizes text, keeps unresolved', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Welcome', fontSize: 80 } }];
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'z1', text: 'Friday Night Lights', fontSize: 9999, color: 'brand red' }], unresolved: ['make it sparkle'] },
      zones,
    );
    expect(r.diff.length).toBe(1);
    expect(r.diff[0].zoneId).toBe('z1');
    expect(r.diff[0].patch.defaultConfig.content).toBe('Friday Night Lights');
    expect(r.diff[0].patch.defaultConfig.fontSize).toBe(400); // clamped to max
    expect(r.diff[0].patch.defaultConfig.color).toBe('var(--brand-primary)');
    expect(r.unresolved).toContain('make it sparkle');
  });

  it('validateChatEditDiff: drops edits for zoneIds not in the selection (no escalation)', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'NOT_SELECTED', fontSize: 50 }] }, zones);
    expect(r.diff.length).toBe(0);
  });

  it('validateChatEditDiff: rejects an injected CSS color value (zone dropped if no other key)', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'z1', color: 'red; background:url(http://evil)' }] }, zones);
    expect(r.diff.length).toBe(0);
  });

  it('validateChatEditDiff: text on a non-text widget (CLOCK) is dropped', () => {
    const r = validateChatEditDiff({ edits: [{ zoneId: 'c1', text: 'hi' }] }, [{ id: 'c1', widgetType: 'CLOCK' }]);
    expect(r.diff.length).toBe(0);
  });

  it('resolveChatEdit: applies a validated diff + records one slot', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [{ zoneId: 'z1', text: 'Go Team', fontSize: 100, color: 'brand-primary' }] }) });
    const fake = makeFakeRedisClient();
    const { service } = buildService(fake);
    const r = await service.resolveChatEdit({
      tenantId: 't1',
      instruction: 'say Go Team, bigger, in our brand red',
      zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'x', fontSize: 80 } }],
    });
    expect(r.diff.length).toBe(1);
    expect(r.diff[0].patch.defaultConfig.color).toBe('var(--brand-primary)');
    expect(fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1').length).toBe(1);
  });

  it('resolveChatEdit: 422 NO_RESOLVABLE_EDITS when nothing maps', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [{ zoneId: 'UNKNOWN', fontSize: 50 }], unresolved: ['make it sparkle'] }) });
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.resolveChatEdit({ tenantId: 't1', instruction: 'do magic', zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NO_RESOLVABLE_EDITS' }) });
  });

  it('resolveChatEdit: rejects empty instruction and empty selection', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.resolveChatEdit({ tenantId: 't1', instruction: '   ', zones: [{ id: 'z1', widgetType: 'TEXT' }] })).rejects.toBeTruthy();
    await expect(service.resolveChatEdit({ tenantId: 't1', instruction: 'x', zones: [] })).rejects.toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

// ── Slice 2a-full — chat-to-edit geometry + style ──
describe('AiService — Slice 2a-full chat-to-edit geometry/style', () => {
  it('validateChatEditDiff: geometry clamps + returns ZONE-LEVEL patch keys', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', x: 5, y: 8, width: 60, height: 18, zIndex: 2, defaultConfig: {} }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'z1', y: 200, width: 150, zIndex: 9999 }] }, zones);
    expect(r.diff.length).toBe(1);
    expect(r.diff[0].patch.y).toBe(100);     // clamped 0–100
    expect(r.diff[0].patch.width).toBe(100); // clamped ≤100
    expect(r.diff[0].patch.zIndex).toBe(999);// clamped ≤999
    expect(r.diff[0].patch.defaultConfig).toBeUndefined(); // geometry-only → no config key
  });

  it('validateChatEditDiff: bold / align / lineHeight map onto config keys', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'z1', bold: true, align: 'center', lineHeight: 5 }] }, zones);
    expect(r.diff[0].patch.defaultConfig.bold).toBe(true);
    expect(r.diff[0].patch.defaultConfig.alignment).toBe('center');
    expect(r.diff[0].patch.defaultConfig.lineHeight).toBe(3); // clamped 0.8–3
  });

  it('validateChatEditDiff: an invalid align value is ignored (zone dropped if nothing else)', () => {
    const zones = [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'z1', align: 'diagonal' }] }, zones);
    expect(r.diff.length).toBe(0);
  });
});

describe('AiService — Slice 2a-multi chat-to-edit multi-zone', () => {
  it('validateChatEditDiff: returns one diff entry per edited zone', () => {
    const zones = [
      { id: 'a', widgetType: 'TEXT', defaultConfig: { fontSize: 80 } },
      { id: 'b', widgetType: 'IMAGE', defaultConfig: {} },
    ];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'a', fontSize: 60 }, { zoneId: 'b', width: 40 }] }, zones);
    expect(r.diff.length).toBe(2);
    expect(r.diff.map((d) => d.zoneId).sort()).toEqual(['a', 'b']);
    // fontSize on the TEXT zone, width (geometry) on the IMAGE zone.
    expect(r.diff.find((d) => d.zoneId === 'a')!.patch.defaultConfig.fontSize).toBe(60);
    expect(r.diff.find((d) => d.zoneId === 'b')!.patch.width).toBe(40);
  });
});

// ── Slice 1b — per-tenant brand voice + chat-edit add/delete intent ──
describe('AiService — Slice 1b brand voice + add/delete intent', () => {
  beforeEach(() => {
    delete process.env.AI_FREE_TIER_CAP;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('prependVoices stacks vertical voice + brand voice on top of the base', () => {
    const out = prependVoices('BASE', 'SPORTS', 'warm and a little playful');
    expect(out).toContain('AUDIENCE');        // SPORTS vertical clause
    expect(out).toContain('BRAND VOICE');
    expect(out).toContain('warm and a little playful');
    expect(out.endsWith('BASE')).toBe(true);
    expect(prependVoices('BASE', 'SPORTS', null)).not.toContain('BRAND VOICE');
    expect(brandVoiceClause('')).toBe('');
  });

  it("threads the tenant's brand voice into generate()'s system prompt", async () => {
    brandingByTenant.set('t1', { brandVoice: 'plainspoken and warm' });
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Hi' }]) });
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'open house' });
    const system = String(dispatchMock.mock.calls[0][1].system);
    expect(system).toContain('BRAND VOICE');
    expect(system).toContain('plainspoken and warm');
  });

  it('omits the brand-voice clause when the tenant has none set', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Hi' }]) });
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'open house' });
    expect(String(dispatchMock.mock.calls[0][1].system)).not.toContain('BRAND VOICE');
  });

  it('chat-edit → helpful ADD message when the instruction wants a new element', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [] }) });
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.resolveChatEdit({ tenantId: 't1', instruction: 'add a countdown next to the title', zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NO_RESOLVABLE_EDITS', message: expect.stringMatching(/palette/i) }) });
  });

  it('chat-edit → helpful DELETE message when the instruction wants removal', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [] }) });
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.resolveChatEdit({ tenantId: 't1', instruction: 'delete the sponsor bar', zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: {} }] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: expect.stringMatching(/Delete/i) }) });
  });
});

// ── AI image generation (2026-06-26) ────────────────────────────────
// generateImage() calls the provider's IMAGE endpoint via the global
// `fetch` (NOT dispatchAi — that's text-only), decodes the base64 image,
// uploads it via the storage mock, and creates an Asset row. These pin:
//   (a) anthropic/platform tenant → graceful AI_IMAGE_UNAVAILABLE (503,
//       NOT a 500 stack)
//   (b) openai tenant → calls the OpenAI images endpoint + persists an
//       Asset (storage.upload + asset.create both fire)
//   (c) an AuditLog row (AI_IMAGE_GENERATED) is written on success
//   (d) the tight 15/hr image cap is enforced from Redis
//   (e) Google (Imagen) tenant hits the :predict endpoint and persists
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function okJson(body: any) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
}
function errResp(status: number, body: string) {
  return { ok: false, status, json: async () => JSON.parse(body || '{}'), text: async () => body } as any;
}

describe('AiService — AI image generation', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    delete process.env.AI_IMAGE_HOURLY_CAP;
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    (prismaMock.client.asset.create as jest.Mock).mockClear();
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('(a) anthropic/platform tenant → graceful AI_IMAGE_UNAVAILABLE, not a 500', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'; // platform fallback = anthropic
    const { service, storage } = buildService(makeFakeRedisClient());
    let caught: any;
    try {
      await service.generateImage({ tenantId: 't1', userId: 'u1', role: 'SCHOOL_ADMIN', prompt: 'a blue mascot' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    // 503 ServiceUnavailable with a stable code — NEVER a 500 stack.
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_IMAGE_UNAVAILABLE' });
    // No provider call, no upload, no asset row.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
  });

  it('(b)+(c) openai tenant → calls OpenAI images endpoint, persists an Asset, writes an AuditLog row', async () => {
    // BYOK OpenAI tenant.
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    // ai-key-cipher.openAiKey decrypts the stored blob — stub it so the
    // fake 'enc' resolves to a usable key without real crypto.
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));

    const { service, storage } = buildService(makeFakeRedisClient());
    const res = await service.generateImage({ tenantId: 't1', userId: 'u1', role: 'SCHOOL_ADMIN', prompt: 'a friendly blue lion mascot' });

    // (b) the OpenAI images endpoint was hit.
    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toBe('https://api.openai.com/v1/images/generations');
    // Asset persisted via storage + prisma; admin role → PUBLISHED.
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.upload.mock.calls[0][2]).toBe('image/png');
    expect(prismaMock.client.asset.create).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ id: 'asset_generated_1', provider: 'openai', status: 'PUBLISHED' });
    expect(res.fileUrl).toContain('/object/public/assets/');
    expect(res.name).toMatch(/^AI: a friendly blue lion mascot/);

    // (c) AuditLog row written on success.
    const auditRow = auditRows.find((r) => r.action === 'AI_IMAGE_GENERATED');
    expect(auditRow).toBeDefined();
    expect(auditRow.targetId).toBe('asset_generated_1');
    const details = JSON.parse(auditRow.details);
    expect(details).toMatchObject({ provider: 'openai', source: 'tenant', assetId: 'asset_generated_1' });
    // Privacy: prompt CONTENT is never logged, only its length.
    expect(auditRow.details).not.toContain('lion mascot');
    expect(details.promptLen).toBeGreaterThan(0);
  });

  // REGRESSION (live beta 2026-06-26): the FE/enum carries orientation as
  // the DALL-E size vocabulary (1792x1024 / 1024x1792), but gpt-image-1
  // ONLY accepts 1024x1024 / 1536x1024 / 1024x1536 and 400s on a DALL-E
  // size ("Invalid size '1792x1024'…"). callOpenAiImage must re-map the
  // requested orientation to the gpt-image-1 vocabulary before sending.
  it('OpenAI gpt-image-1 → landscape 1792x1024 is re-mapped to 1536x1024 in the request body', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'wide stadium banner', size: '1792x1024' });
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.model).toBe('gpt-image-1');
    expect(reqBody.size).toBe('1536x1024'); // gpt-image-1 vocabulary, NOT the DALL-E 1792x1024
  });

  it('OpenAI gpt-image-1 → portrait 1024x1792 is re-mapped to 1024x1536 in the request body', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'tall poster', size: '1024x1792' });
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.size).toBe('1024x1536'); // gpt-image-1 vocabulary, NOT the DALL-E 1024x1792
  });

  it('OpenAI dall-e-3 fallback → keeps the DALL-E size vocabulary (1792x1024) it actually accepts', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    // First call (gpt-image-1) 404s "model not found" → triggers the dall-e-3 fallback.
    fetchSpy
      .mockResolvedValueOnce(errResp(404, JSON.stringify({ error: { message: 'The model gpt-image-1 does not exist' } })))
      .mockResolvedValueOnce(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'wide banner', size: '1792x1024' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(String(fetchSpy.mock.calls[1][1].body));
    expect(fallbackBody.model).toBe('dall-e-3');
    expect(fallbackBody.size).toBe('1792x1024'); // valid for dall-e-3 — must NOT be re-mapped
  });

  it('CONTRIBUTOR role → generated image lands in the review queue (PENDING_APPROVAL)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    const res = await service.generateImage({ tenantId: 't1', userId: 'u1', role: 'CONTRIBUTOR', prompt: 'hero banner' });
    expect(res.status).toBe('PENDING_APPROVAL');
  });

  it('(d) image cap (15/hr) enforced — over cap → AI_IMAGE_CAP_REACHED, no provider call', async () => {
    process.env.AI_IMAGE_HOURLY_CAP = '2';
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const redis = makeFakeRedisClient();
    const { service } = buildService(redis);
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'one' });
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'two' });
    fetchSpy.mockClear();
    let caught: any;
    try {
      await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'three' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(429);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_IMAGE_CAP_REACHED' });
    expect(fetchSpy).not.toHaveBeenCalled(); // door-check, never hits the provider
  });

  it('(e) Google (BYOK) tenant → hits the Imagen :predict endpoint and persists', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'google', aiKeyEncrypted: 'enc', aiModel: 'gemini-2.5-flash' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('AIzaTestKey');
    fetchSpy.mockResolvedValue(okJson({ predictions: [{ bytesBase64Encoded: TINY_PNG_B64 }] }));
    const { service, storage } = buildService(makeFakeRedisClient());
    const res = await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'sunset over a stadium', size: '1792x1024' });
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('imagen-3.0-generate-002:predict');
    // Aspect ratio mapped from the landscape size.
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.parameters.aspectRatio).toBe('16:9');
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ provider: 'google', id: 'asset_generated_1' });
  });

  it('out-of-credit OpenAI → structured 402 AI_PROVIDER_OUT_OF_CREDIT (no asset persisted)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(errResp(429, JSON.stringify({ error: { type: 'insufficient_quota' } })));
    const { service, storage } = buildService(makeFakeRedisClient());
    let caught: any;
    try {
      await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'x' });
    } catch (e) { caught = e; }
    expect(caught.getStatus()).toBe(402);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_PROVIDER_OUT_OF_CREDIT' });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
  });

  it('empty prompt → BadRequest, no provider call', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: '   ' }))
      .rejects.toMatchObject({ status: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Wave 3 (2026-06-27) — REAL AI background imagery for the IMAGE archetypes.
//   parseArtDirectorSpec now accepts an image plan ('generate'/'stock'/'none')
//   + a sanitized prompt; generateSignageBoard({withImage:true}) generates a
//   photo and injects it behind the scrim — but ONLY for an image-bg archetype,
//   ONLY when a usable image provider exists, and NEVER throws if it can't.
// ───────────────────────────────────────────────────────────────────────

describe('parseArtDirectorSpec — Wave 3 image-mode coercion', () => {
  it('coerces a generate plan and SANITIZES the prompt (clamps + strips control chars)', () => {
    const dirty = 'A stadium\nat\tgolden\x00 hour'; // newline/tab/NUL → single spaces
    const spec = parseArtDirectorSpec({
      archetype: 'hero-fullbleed',
      copy: { headline: 'Go Team' },
      image: { mode: 'generate', prompt: dirty },
    });
    expect(spec.image.mode).toBe('generate');
    expect(spec.image.prompt).toBe('A stadium at golden hour'); // control bytes collapsed
    expect(spec.image.prompt).not.toMatch(/[\x00-\x1F\x7F]/);
  });

  // PHOTO-FORWARD DEFAULT (2026-06-28): a photo-appropriate archetype with an
  // absent / invalid / unknown image plan now defaults to a STOCK photo (the
  // gradient is the FALLBACK, not the default outcome). The text-/data-dense
  // archetypes still default to mode:none (a photo would fight their dense type).
  it('defaults a PHOTO-appropriate archetype to mode:stock when image is absent / invalid / unknown mode', () => {
    expect(parseArtDirectorSpec({ archetype: 'hero-fullbleed', copy: { headline: 'h' } }).image.mode).toBe('stock');
    expect(parseArtDirectorSpec({ archetype: 'hero-fullbleed', copy: { headline: 'h' }, image: 'nope' }).image.mode).toBe('stock');
    expect(parseArtDirectorSpec({ archetype: 'hero-fullbleed', copy: { headline: 'h' }, image: { mode: 'wat' } }).image.mode).toBe('stock');
    // split-50 (photo lands on the image half) is photo-appropriate too.
    expect(parseArtDirectorSpec({ archetype: 'split-50', copy: { headline: 'h' } }).image.mode).toBe('stock');
    // An EXPLICIT mode:none on a photo archetype is upgraded to stock as well —
    // the operator's explicit non-photo choice is honored UPSTREAM (intake),
    // never by the model emitting 'none' (which is just "I didn't bother").
    expect(parseArtDirectorSpec({ archetype: 'poster-promo', copy: { headline: 'h' }, image: { mode: 'none' } }).image.mode).toBe('stock');
  });

  it('still defaults a TEXT/DATA-dense archetype to mode:none (gradient — a photo fights the type)', () => {
    for (const archetype of ['stat-spotlight', 'three-up-grid', 'menu-list', 'quote-spotlight', 'title-cta']) {
      expect(parseArtDirectorSpec({ archetype, copy: { headline: 'h' } }).image.mode).toBe('none');
    }
  });

  it('folds a generate plan with NO usable prompt down to mode:none (no empty plan)', () => {
    const spec = parseArtDirectorSpec({
      archetype: 'poster-promo',
      copy: { headline: 'Sale' },
      image: { mode: 'generate', prompt: '   ' },
    });
    expect(spec.image.mode).toBe('none');
    expect(spec.image.prompt).toBeUndefined();
  });

  it('clamps an over-long prompt to 600 chars', () => {
    const spec = parseArtDirectorSpec({
      archetype: 'hero-fullbleed',
      copy: { headline: 'h' },
      image: { mode: 'generate', prompt: 'x'.repeat(2000) },
    });
    expect(spec.image.prompt!.length).toBe(600);
  });

  it('parses an image plan PER SCENE in a multi-scene spec', () => {
    const spec = parseArtDirectorSpec({
      archetype: 'title-cta',
      copy: { headline: 'Welcome' },
      image: { mode: 'none' },
      scenes: [
        { name: 'Home', archetype: 'title-cta', copy: { headline: 'Home' }, image: { mode: 'none' } },
        { name: 'Promo', archetype: 'poster-promo', copy: { headline: 'Deal' }, image: { mode: 'generate', prompt: 'a bright cafe interior' } },
      ],
    });
    expect(spec.scenes![1].image.mode).toBe('generate');
    expect(spec.scenes![1].image.prompt).toBe('a bright cafe interior');
  });
});

describe('AiService — generateSignageBoard Wave 3 background imagery', () => {
  // A valid ArtDirectorSpec the model "returns" → drives the engine path.
  const boardSpec = (image: any = { mode: 'none' }, archetype = 'hero-fullbleed') =>
    JSON.stringify({
      archetype,
      theme: 'neon-sports',
      copy: { kicker: 'TONIGHT', headline: 'Go Eagles', cta: 'Tip-off 7PM' },
      image,
      accentSlot: 'cta',
    });

  const TINY_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  function okJson(body: any) {
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
  }

  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    delete process.env.AI_IMAGE_HOURLY_CAP;
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    (prismaMock.client.asset.create as jest.Mock).mockClear();
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });
  afterEach(() => fetchSpy.mockRestore());

  it('NO provider configured → still returns a valid board, NO assetUrl, no throw', async () => {
    // No BYOK key, no platform key → resolveProviderKey returns null upstream,
    // so this actually throws "AI is not configured" BEFORE the model call.
    // The contract we pin here is the WITH-a-provider-but-no-IMAGE-provider
    // case: a platform (anthropic) tenant gets a board on the gradient.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'generate', prompt: 'a packed arena at night' }) });
    const { service } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({
      tenantId: 't1', prompt: 'sports board', withImage: true,
    });

    // Valid board produced.
    expect(board.zones.length).toBeGreaterThan(0);
    expect(board.archetype).toBe('hero-fullbleed');
    // Platform = anthropic → no image provider → no photo generated, no throw.
    expect(board.backgroundImageUrl).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled(); // never reached an image endpoint
    const bg = board.zones.find((z: any) => z.widgetType === 'IMAGE' && z.name === 'background');
    expect(bg).toBeDefined();
    expect(bg.defaultConfig.assetUrl).toBeUndefined(); // rides the gradient
    expect(bg.defaultConfig.bgGradient).toBeTruthy();
  });

  it('withImage=false (default) → NEVER generates an image even on an image-bg archetype', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'generate', prompt: 'a packed arena at night' }) });
    const { service } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({ tenantId: 't1', prompt: 'sports board' }); // withImage omitted

    expect(board.backgroundImageUrl).toBeUndefined();
    // fetch is the image endpoint; the text dispatch is the mocked dispatchAi,
    // so a clean board must hit NO fetch at all when withImage is off.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('withImage=true + OpenAI BYOK + image-bg archetype + generate plan → injects assetUrl behind the scrim', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'generate', prompt: 'a packed arena under stadium lights, wide negative space' }) });
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service, storage } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({
      tenantId: 't1', userId: 'u1', role: 'SCHOOL_ADMIN', prompt: 'sports board',
      screenWidth: 1920, screenHeight: 1080, withImage: true,
    });

    // The OpenAI images endpoint was hit + a landscape size requested.
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toBe('https://api.openai.com/v1/images/generations');
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.size).toBe('1536x1024'); // landscape → gpt-image-1 vocabulary
    // Photo persisted as an asset + injected onto the background zone.
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(board.backgroundImageUrl).toBeTruthy();
    const bg = board.zones.find((z: any) => z.widgetType === 'IMAGE' && z.name === 'background');
    expect(bg.defaultConfig.assetUrl).toBe(board.backgroundImageUrl);
    expect(bg.defaultConfig.fit).toBe('cover');
    // Top-level bg descriptor mirrors the photo too.
    expect(board.background.bgImage).toBe(board.backgroundImageUrl);
    // Both the board-gen AND the image-gen are audited.
    expect(auditRows.some((r) => r.action === 'AI_SIGNAGE_BOARD_GENERATED')).toBe(true);
    expect(auditRows.some((r) => r.action === 'AI_IMAGE_GENERATED')).toBe(true);
  });

  it('withImage=true but the model planned mode:none → no image generated', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'none' }) });
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'sports board', withImage: true });
    expect(board.backgroundImageUrl).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('withImage=true + generate plan but a NON-image archetype (stat-spotlight) → no image generated', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'generate', prompt: 'a stadium' }, 'stat-spotlight') });
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'big number', withImage: true });
    expect(board.archetype).toBe('stat-spotlight');
    expect(board.backgroundImageUrl).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled(); // stat-spotlight has no image bg
  });

  it('image-gen FAILURE (provider 500) → board STILL ships on its gradient, no throw', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockResolvedValue({ raw: boardSpec({ mode: 'generate', prompt: 'a packed arena' }) });
    // gpt-image-1 AND the dall-e-3 fallback both 500 → callOpenAiImage throws,
    // generateBoardBackground swallows it → board rides the gradient.
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => 'upstream boom' } as any);
    const { service } = buildService(makeFakeRedisClient());

    const board = await service.generateSignageBoard({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'sports board', withImage: true });

    expect(board.zones.length).toBeGreaterThan(0);
    expect(board.backgroundImageUrl).toBeUndefined();
    const bg = board.zones.find((z: any) => z.widgetType === 'IMAGE' && z.name === 'background');
    expect(bg.defaultConfig.assetUrl).toBeUndefined();
    expect(bg.defaultConfig.bgGradient).toBeTruthy();
    // The board-gen still succeeded + was audited.
    expect(auditRows.some((r) => r.action === 'AI_SIGNAGE_BOARD_GENERATED')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 2026-06-27 — refine-drops-scenes guard. refineSignageBoard runs a delta
// prompt; if the model answers as if editing a SINGLE board (drops the
// "scenes" array, or returns fewer scenes) a multi-scene SET would silently
// collapse to one board — the operator's whole loop wiped. The guard forces a
// refined set back to AT LEAST the original scene count.
// ───────────────────────────────────────────────────────────────────────
describe('AiService — refineSignageBoard keeps every scene of a SET', () => {
  // A FULL multi-scene set spec (what the UI hands back as opts.spec).
  const SET_SPEC = {
    archetype: 'title-cta',
    theme: 'neon-sports',
    copy: { headline: 'Welcome' },
    accentSlot: 'cta',
    scenes: [
      { name: 'Welcome', archetype: 'title-cta', theme: 'neon-sports', copy: { headline: 'Welcome' }, accentSlot: 'cta' },
      { name: 'Featured', archetype: 'poster-promo', theme: 'neon-sports', copy: { headline: 'Tonight 7PM' }, accentSlot: 'headline' },
      { name: 'Hours', archetype: 'stat-spotlight', theme: 'neon-sports', copy: { headline: 'Open till 11' }, accentSlot: 'stat' },
    ],
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    // BYOK Anthropic tenant → resolveProviderKey returns a usable provider so
    // the refine path runs end-to-end (dispatchAi is mocked). openAiKey() is the
    // generic decrypt for every provider's sealed key (see resolveProviderKey).
    tenantsById.set('t1', { id: 't1', aiProvider: 'anthropic', aiKeyEncrypted: 'enc', aiModel: 'claude-3-5-haiku' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-ant-byok');
  });

  it('model collapsed the set to a single board → all 3 scenes restored, in order', async () => {
    // The model answered as if editing ONE board (no "scenes" array at all).
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({
        archetype: 'title-cta', theme: 'midnight-tech',
        copy: { headline: 'Welcome — refreshed' }, accentSlot: 'cta',
      }),
    });
    const { service } = buildService(makeFakeRedisClient());

    const out = await service.refineSignageBoard({
      tenantId: 't1', spec: SET_SPEC, instruction: 'make it more premium',
    });

    // The SET survived — still 3 scenes. Scene 1 = the model's collapsed board
    // (its edit preserved; name derives from the refreshed headline since the
    // collapsed board carried no scene name); scenes 2-3 backfilled verbatim.
    expect(out.candidate.scenes).toBeDefined();
    expect(out.candidate.scenes!.length).toBe(3);
    expect(out.candidate.scenes!.map((s) => s.name)).toEqual(['Welcome — refreshed', 'Featured', 'Hours']);
    // Zones span all 3 scenes (not a single-board zone set).
    const sceneRefs = new Set(out.candidate.zones.map((z: any) => z.sceneRef).filter(Boolean));
    expect(sceneRefs.size).toBe(3);
  });

  it('model dropped the tail scene → the missing scene is backfilled', async () => {
    // Model returned only the first 2 of 3 scenes.
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({
        archetype: 'title-cta', theme: 'neon-sports', copy: { headline: 'Welcome' }, accentSlot: 'cta',
        scenes: [
          { name: 'Welcome', archetype: 'title-cta', theme: 'neon-sports', copy: { headline: 'Welcome!' }, accentSlot: 'cta' },
          { name: 'Featured', archetype: 'poster-promo', theme: 'neon-sports', copy: { headline: 'Tonight 7PM' }, accentSlot: 'headline' },
        ],
      }),
    });
    const { service } = buildService(makeFakeRedisClient());

    const out = await service.refineSignageBoard({
      tenantId: 't1', spec: SET_SPEC, instruction: 'punchier first slide',
    });

    expect(out.candidate.scenes!.length).toBe(3);
    expect(out.candidate.scenes!.map((s) => s.name)).toEqual(['Welcome', 'Featured', 'Hours']);
  });

  it('model kept all scenes → its edits pass through unchanged (no spurious restore)', async () => {
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({
        archetype: 'title-cta', theme: 'midnight-tech', copy: { headline: 'Welcome' }, accentSlot: 'cta',
        scenes: [
          { name: 'Hello', archetype: 'title-cta', theme: 'midnight-tech', copy: { headline: 'Hello' }, accentSlot: 'cta' },
          { name: 'Featured', archetype: 'poster-promo', theme: 'midnight-tech', copy: { headline: 'Tonight 7PM' }, accentSlot: 'headline' },
          { name: 'Hours', archetype: 'stat-spotlight', theme: 'midnight-tech', copy: { headline: 'Open till 11' }, accentSlot: 'stat' },
        ],
      }),
    });
    const { service } = buildService(makeFakeRedisClient());

    const out = await service.refineSignageBoard({
      tenantId: 't1', spec: SET_SPEC, instruction: 'darker theme, rename slide 1',
    });

    expect(out.candidate.scenes!.length).toBe(3);
    // The model's rename of scene 1 ('Welcome' → 'Hello') is preserved.
    expect(out.candidate.scenes!.map((s) => s.name)).toEqual(['Hello', 'Featured', 'Hours']);
  });

  it('a SINGLE-board refine still returns a single board (guard is set-only)', async () => {
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({
        archetype: 'hero-fullbleed', theme: 'neon-sports', copy: { headline: 'Go Eagles' }, accentSlot: 'cta',
      }),
    });
    const { service } = buildService(makeFakeRedisClient());

    const out = await service.refineSignageBoard({
      tenantId: 't1',
      spec: { archetype: 'hero-fullbleed', theme: 'neon-sports', copy: { headline: 'Eagles' }, accentSlot: 'cta' },
      instruction: 'punchier headline',
    });

    expect(out.candidate.scenes).toBeUndefined();
    expect(out.candidate.zones.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// IMAGERY wave (2026-06-28) — AUTO-PHOTO ON THE KEPT BOARD.
//   attachKeptBoardPhoto makes the ACCEPTED candidate photo-rich, best-effort +
//   cost-bounded: STOCK first (free, when PEXELS_API_KEY is set), else an AI
//   photo (the tenant's BYOK image provider — NEVER the platform Tier-1 key), at
//   most ONE image. Any miss/error keeps the gradient (never throws). These pin:
//     (1) STOCK-when-key — a Pexels photo is fetched + landed on the bg zone
//     (2) AI-FALLBACK — no stock key but a BYOK image provider → generateImage
//     (3) GRACEFUL-NONE — no key + no image provider → undefined, gradient kept
//     (4) SKIP when the board already carries a real photo (no double-spend)
//     (5) SKIP for a non-photo-appropriate archetype (gradient kept)
// ───────────────────────────────────────────────────────────────────────
describe('AiService — attachKeptBoardPhoto (auto-photo on accept)', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    (prismaMock.client.asset.create as jest.Mock).mockClear();
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });
  afterEach(() => fetchSpy.mockRestore());

  // A minimal gradient-only hero board (the candidate's bg zone the fan-out built).
  // Typed `any[]` so the tests can read the mutated `defaultConfig.assetUrl` (the
  // service drops the photo URL there) without strict shape narrowing.
  const gradientHeroZones = (): any[] => [
    { name: 'background', widgetType: 'IMAGE', defaultConfig: { fit: 'cover', bgGradient: 'linear-gradient(...)' } },
    { name: 'headline', widgetType: 'TEXT', defaultConfig: { content: 'Happy Hour' } },
  ];
  const heroSpec = () => ({
    archetype: 'hero-fullbleed',
    theme: 'bold-retail',
    copy: { headline: 'Happy Hour' },
    image: { mode: 'stock', query: 'craft beer pour bar counter' },
    accentSlot: 'cta',
  });

  it('(1) STOCK-when-key: lands a free Pexels photo on the background zone + returns the URL', async () => {
    // Platform (anthropic) tenant — no image provider — proving STOCK is provider-agnostic.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const stock = {
      isConfigured: jest.fn(() => true),
      search: jest.fn(async () => ({ url: 'https://images.pexels.com/photos/1/x.jpg' })),
    };
    const { service } = buildService(makeFakeRedisClient(), undefined, stock);
    const zones = gradientHeroZones();

    const url = await service.attachKeptBoardPhoto({
      tenantId: 't1', userId: 'u1', role: 'SCHOOL_ADMIN',
      zones, background: { bgGradient: 'linear-gradient(...)' },
      spec: heroSpec(), archetype: 'hero-fullbleed',
      screenWidth: 1920, screenHeight: 1080, vertical: 'BAR',
    });

    expect(stock.search).toHaveBeenCalledTimes(1);
    // The cleaned query the model supplied is what we searched.
    const searchArgs = (stock.search.mock.calls[0] as any[]);
    expect(searchArgs[0]).toBe('craft beer pour bar counter');
    expect(searchArgs[1]).toMatchObject({ orientation: 'landscape' });
    expect(url).toBe('https://images.pexels.com/photos/1/x.jpg');
    // It landed on the background zone's assetUrl.
    expect(zones[0].defaultConfig.assetUrl).toBe(url);
    expect(zones[0].defaultConfig.fit).toBe('cover');
    // STOCK is free → no image provider call, no AI image generated.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
  });

  it('(2) AI-FALLBACK: no stock key but a BYOK OpenAI provider → generates ONE photo', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    // Stock OFF (no PEXELS key) so the path falls through to AI.
    const stock = { isConfigured: jest.fn(() => false), search: jest.fn(async () => null) };
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service, storage } = buildService(makeFakeRedisClient(), undefined, stock);
    const zones = gradientHeroZones();

    const url = await service.attachKeptBoardPhoto({
      tenantId: 't1', userId: 'u1', role: 'SCHOOL_ADMIN',
      zones, background: { bgGradient: 'linear-gradient(...)' },
      spec: { ...heroSpec(), image: { mode: 'stock', query: 'craft beer pour', prompt: 'a cinematic craft beer pour' } },
      archetype: 'hero-fullbleed',
      screenWidth: 1920, screenHeight: 1080, vertical: 'BAR',
    });

    // Stock was attempted (key off → search not even called) and AI produced the photo.
    expect(stock.search).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.openai.com/v1/images/generations');
    expect(storage.upload).toHaveBeenCalledTimes(1);
    // The AI photo is a Supabase asset URL, landed on the bg zone.
    expect(url).toContain('/object/public/assets/');
    expect(zones[0].defaultConfig.assetUrl).toBe(url);
  });

  it('(3) GRACEFUL-NONE: no stock key + an anthropic/platform tenant → undefined, gradient kept, never throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'; // platform = anthropic, can't make images
    const stock = { isConfigured: jest.fn(() => false), search: jest.fn(async () => null) };
    const { service } = buildService(makeFakeRedisClient(), undefined, stock);
    const zones = gradientHeroZones();

    const url = await service.attachKeptBoardPhoto({
      tenantId: 't1', role: 'SCHOOL_ADMIN',
      zones, background: { bgGradient: 'linear-gradient(...)' },
      spec: heroSpec(), archetype: 'hero-fullbleed',
      screenWidth: 1920, screenHeight: 1080,
    });

    expect(url).toBeUndefined();
    // Never spent the platform Tier-1 key on an image; the gradient zone is untouched.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
    expect(zones[0].defaultConfig.assetUrl).toBeUndefined();
    expect(zones[0].defaultConfig.bgGradient).toBeTruthy();
  });

  it('(4) SKIP when the board already carries a real photo (no double-spend)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const stock = { isConfigured: jest.fn(() => true), search: jest.fn(async () => ({ url: 'https://images.pexels.com/photos/2/y.jpg' })) };
    const { service } = buildService(makeFakeRedisClient(), undefined, stock);
    const zones = gradientHeroZones();

    const url = await service.attachKeptBoardPhoto({
      tenantId: 't1', role: 'SCHOOL_ADMIN',
      zones,
      background: { bgImage: 'https://images.pexels.com/photos/existing/z.jpg' }, // already a photo
      spec: heroSpec(), archetype: 'hero-fullbleed',
      screenWidth: 1920, screenHeight: 1080,
    });

    expect(url).toBeUndefined();
    expect(stock.search).not.toHaveBeenCalled(); // never searched — board was already photo-rich
  });

  it('(5) SKIP for a non-photo-appropriate archetype (menu-list keeps its gradient)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const stock = { isConfigured: jest.fn(() => true), search: jest.fn(async () => ({ url: 'https://images.pexels.com/photos/3/q.jpg' })) };
    const { service } = buildService(makeFakeRedisClient(), undefined, stock);
    const zones = [{ name: 'headline', widgetType: 'TEXT', defaultConfig: { content: 'Menu' } }];

    const url = await service.attachKeptBoardPhoto({
      tenantId: 't1', role: 'SCHOOL_ADMIN',
      zones, background: { bgGradient: 'linear-gradient(...)' },
      spec: { archetype: 'menu-list', theme: 'qsr-appetite', copy: { headline: 'Menu' }, image: { mode: 'none' }, accentSlot: 'none' },
      archetype: 'menu-list',
      screenWidth: 1920, screenHeight: 1080,
    });

    expect(url).toBeUndefined();
    expect(stock.search).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// signageCandidatePlan — the 3-candidate "pick your favorite" diversity source.
// The bug (2026-06-28): a consistent reasoning model (GPT-5) ignored the soft
// per-candidate prompt hint and returned three IDENTICAL boards (same archetype
// + theme), so the picker showed three clones ("they all look the same until you
// click into them"). The fix forces a DISTINCT archetype + theme per take at the
// engine level; this pins that the plan actually produces distinct, valid takes.
// ───────────────────────────────────────────────────────────────────────────
describe('signageCandidatePlan — distinct candidate takes (no clones)', () => {
  const ids = new Set(ARCHETYPE_IDS as readonly string[]);

  it('gives each of the 3 takes a DISTINCT archetype for a known vertical', () => {
    const plan = signageCandidatePlan('bar', 3);
    expect(plan).toHaveLength(3);
    const archetypes = plan.map((p) => p.archetype);
    expect(new Set(archetypes).size).toBe(3); // all different — never three clones
    // bar affinity order = poster-promo, lower-third-banner, title-cta.
    expect(archetypes).toEqual(['poster-promo', 'lower-third-banner', 'title-cta']);
  });

  it('spans DISTINCT themes (not three dark clones) for a mono-tonal vertical', () => {
    // bar affinity is two dark themes; the selector pulls from the versatile
    // premium pool so the 3 takes are visually different, not "boring black x3".
    const themes = signageCandidatePlan('bar', 3).map((p) => p.theme);
    expect(new Set(themes).size).toBeGreaterThanOrEqual(2); // anti-clone invariant
    expect(themes.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
  });

  it('every forced archetype is a real engine archetype id', () => {
    for (const v of ['bar', 'qsr', 'retail', 'k12', 'sports', 'worship', undefined]) {
      for (const take of signageCandidatePlan(v, 3)) {
        expect(ids.has(take.archetype)).toBe(true);
      }
    }
  });

  it('falls back to a populated (NEUTRAL) plan for an unknown vertical', () => {
    const plan = signageCandidatePlan('totally-made-up', 3);
    expect(plan).toHaveLength(3);
    expect(new Set(plan.map((p) => p.archetype)).size).toBe(3);
    expect(plan.every((p) => p.archetype && p.theme && p.directive)).toBe(true);
  });

  it('clamps count to [1,3]', () => {
    expect(signageCandidatePlan('bar', 0)).toHaveLength(1);
    expect(signageCandidatePlan('bar', 9)).toHaveLength(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AI DESIGNER — generateDesignerBoardCandidates fans out distinct designer-grade
// HTML boards (a top model authors each as a full doc; we sanitize). Mirrors the
// candidate caps/spend discipline. dispatchAi is mocked (no real provider call).
// ───────────────────────────────────────────────────────────────────────────
describe('AiService — AI Designer HTML candidates', () => {
  const fakeBoard = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Chrome Coffee</h1>'
    + '<script src="https://evil.example/x.js"></script>'
    + '<script>var s=1;/* self-scale */</script></div></body></html>';

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('fans out 3 designer boards, sanitizes the HTML, records spend per board', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: fakeBoard });
    const { service } = buildService(fake);

    const res = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'designer coffee menu',
      vertical: 'qsr',
      venueName: 'Chrome Coffee',
      palette: ['#23282f', '#f0523d'],
      content: 'Espresso 3.50',
    });

    expect(res.candidates).toHaveLength(3);
    expect(dispatchMock).toHaveBeenCalledTimes(3); // one provider call per board
    for (const c of res.candidates) {
      expect(c.html).toContain('<!doctype html>');
      expect(c.html).toContain('data-field="headline"');
      expect(c.html).toContain('var s=1'); // inline self-scale script kept
      expect(c.html).not.toMatch(/<script[^>]*src=/i); // remote script stripped
      expect(c.screenWidth).toBe(1920);
      expect(c.name).toBe('Chrome Coffee');
    }
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(3); // honest hourly accounting
  });

  it('surfaces the provider error when EVERY board fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: '', errorStatus: 500, errorBody: 'boom' });
    const { service } = buildService(fake);
    await expect(
      service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'x' }),
    ).rejects.toBeDefined();
  });
});
