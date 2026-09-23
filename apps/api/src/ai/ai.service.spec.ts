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
import { AiService, sanitizeRewriteText, validateChatEditDiff, resolveChatColor, chatEditableFieldKeys, brandVoiceClause, prependVoices, parseArtDirectorSpec, signageCandidatePlan, buildChatEditUserPrompt, normalizeChatFields } from './ai.service';
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

// 2026-09-22 — every provider call is written to the usage ledger (AiUsageMeterService). The
// default fake records what it was asked to write so a spec can assert the metering; the
// allowance is left out (no allowance service = never capped), which suites that exercise the
// limiter pass explicitly.
const meterCalls: any[] = [];
function makeMeterMock() {
  return { record: jest.fn(async (entry: any) => { meterCalls.push(entry); return 0; }) } as any;
}

function buildService(publisher: any, storage?: any, stock?: any, menu?: any, allowance?: any): { service: AiService; storage: any; stock: any; menu: any; altText: any; meter: any } {
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
  // 2026-07-01 (#268 item 5) — AiService now also takes MenuService for
  // auto-grounding menu-ish designer briefs. DEFAULT stub resolves an EMPTY
  // menu (no catalog configured) → generation proceeds exactly as before this
  // feature existed. The auto-ground suite passes its own with real items.
  const menuMock = menu ?? {
    resolveMenuForLocation: jest.fn(async () => ({ locationTenantId: 't1', generatedAt: new Date().toISOString(), categories: [], items: [] })),
  } as any;
  // Synchronous construct — no Nest container needed, but use it for parity.
  const meterMock = makeMeterMock();
  const service = new AiService(prismaMock as PrismaService, redisMock, storageMock as any, altTextMock, stockMock, menuMock, meterMock, allowance);
  return { service, storage: storageMock, stock: stockMock, menu: menuMock, altText: altTextMock, meter: meterMock };
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

  it('writes the call to the dollar-metered usage ledger — platform key, fast job, Standard-tier model', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    okGenerate();
    const { service, meter } = buildService(fake);

    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    // The monthly ceiling is the org's included allowance, summed from this ledger (2026-09-22).
    expect(meter.record).toHaveBeenCalledTimes(1);
    expect(meter.record.mock.calls[0][0]).toMatchObject({
      tenantId: 't1', provider: 'anthropic', model: 'claude-haiku-4-5', source: 'platform', feature: 'sparkle',
    });
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
    // The TENANT's own key is out of credit — theirs to top up, so they get the vendor's steps.
    // (OUR key running dry is a different message: see "our key out of credit" below.)
    tenantsById.set('t1', { id: 't1', aiProvider: 'anthropic', aiKeyEncrypted: 'enc', aiModel: 'standard' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-ant-tenant');
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

// ── S5 (2026-07-16) — economic-model safety: a configured-but-unreadable ──
// BYOK key must NEVER silently fall through to the platform (Tier-1) key.
// The old resolveProviderKey caught a decrypt failure, logged it, and
// returned the platform key + cheapest model — quietly spending VenueOS's
// Tier-1 budget on the tenant's Tier-2/BYOK action while its comment claimed
// the operator would see "AI is not configured" (FALSE whenever
// ANTHROPIC_API_KEY is set, which it is for the Concierge). Now every SPEND
// path throws an actionable AI_KEY_UNREADABLE; only a tenant that NEVER
// configured a key falls back to platform; the status READ (getUsage) stays
// tolerant so the settings page keeps rendering.
describe('AiService — S5 BYOK unreadable-key must not spend platform (Tier-1)', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('BYOK configured + decrypt throws → AI_KEY_UNREADABLE (503), NO platform provider call', async () => {
    // The trap: a BYOK key IS saved, and the platform key IS set (Concierge).
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockImplementation(() => {
      throw new Error('decrypt failed — DEVICE_SECRET_KEY rotated');
    });
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'should never run' }]) });
    const { service } = buildService(makeFakeRedisClient());

    let caught: any;
    try {
      await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_KEY_UNREADABLE' });
    // THE ASSERTION THAT MATTERS: the provider was NEVER called on the
    // platform key — no silent Tier-1 spend.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('BYOK key present but provider unknown/legacy → AI_KEY_UNREADABLE, NO platform call', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'some-legacy-provider', aiKeyEncrypted: 'enc', aiModel: null });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'should never run' }]) });
    const { service } = buildService(makeFakeRedisClient());

    let caught: any;
    try {
      await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_KEY_UNREADABLE' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('NO BYOK key configured + platform key set → platform fallback STILL works (unchanged)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Spring sale starts today.' }]) });
    const { service } = buildService(makeFakeRedisClient());

    const res = await service.generate({ tenantId: 't1', intent: 'announcement', context: 'spring sale' });
    // Platform fallback is intact for a tenant that never configured a key.
    expect(res.options.length).toBeGreaterThan(0);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('getUsage stays tolerant when a BYOK key is unreadable (status read never throws)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    const { service } = buildService(makeFakeRedisClient());
    // Must NOT throw — the settings status endpoint reports keyHealthy
    // separately; a read spends nothing.
    const usage = await service.getUsage('t1');
    expect(usage).toBeDefined();
    // Tolerant fall-through to the platform snapshot (the pre-S5 behaviour).
    expect(usage.source).toBe('platform');
  });
});

// ── Slice 1c (2026-06-16) — 3-candidate "pick-a-winner" generation ──
// generateTouchTemplateCandidates fans out N drafts with diversified
// design-direction seeds, returns sanitized drafts (NOT persisted), and
// records spend PER SUCCESSFUL candidate (honest 3-tier accounting). One
// bad draft must not sink the batch; an all-fail surfaces a real error.
describe('AiService — Slice 1c 3-candidate generation', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
    const { service, meter } = buildService(fake);

    const res = await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby check-in kiosk' });

    expect(res.candidates.length).toBe(3);
    expect(dispatchMock).toHaveBeenCalledTimes(3); // one provider call per candidate
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(3); // honest hourly accounting
    // one ledger row per provider call, on the DESIGN tier (a touch template is a board)
    expect(meter.record).toHaveBeenCalledTimes(3);
    expect(meter.record.mock.calls.every((c: any[]) => c[0].feature === 'touch-template' && c[0].model === 'gpt-6-sol' && c[0].provider === 'openai')).toBe(true);
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

  // ── W0-09 (2026-07-14) — the fan-out must reserve headroom for the WHOLE
  // batch, not one slot. A 3-candidate batch used to pass a 1-slot check
  // (`count >= cap`) at cap-1 and then spend 3 — a 3× over-run on the abuse
  // window AND the platform-dollar counter. Now the check is `used + count > cap`.
  it('W0-09: rejects the whole fan-out BEFORE dispatch when the batch would exceed the hourly cap', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    process.env.AI_HOURLY_CAP = '2'; // cap 2, but a default batch wants 3 slots
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: tpl() });
    const { service } = buildService(fake); // reads AI_HOURLY_CAP at construction

    await expect(
      service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby kiosk' }),
    ).rejects.toThrow(/hourly AI cap/i);
    // Rejected up front: no provider call, no slot burned (the old code would
    // have dispatched 3 and spent 3 against a 2-slot budget).
    expect(dispatchMock).not.toHaveBeenCalled();
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(successAdds.length).toBe(0);
    delete process.env.AI_HOURLY_CAP;
  });

  it('W0-09: admits the fan-out when the batch exactly fits the remaining headroom', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    process.env.AI_HOURLY_CAP = '3'; // exactly enough for a 3-candidate batch from empty
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: tpl() });
    const { service } = buildService(fake);

    const res = await service.generateTouchTemplateCandidates({ tenantId: 't1', prompt: 'lobby kiosk' });

    expect(res.candidates.length).toBe(3);
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    delete process.env.AI_HOURLY_CAP;
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

  it('records one slot + one ledger row on success', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Game night!' }]) });
    const fake = makeFakeRedisClient();
    const { service, meter } = buildService(fake);
    await service.rewriteText({ tenantId: 't1', widgetType: 'ANNOUNCEMENT', fieldKey: 'message', currentText: 'game', op: 'punch' });
    const adds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    expect(adds.length).toBe(1);
    expect(meter.record).toHaveBeenCalledTimes(1);
    expect(meter.record.mock.calls[0][0]).toMatchObject({ feature: 'rewrite', source: 'platform' });
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
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
    // Relative clamp (field-audit fix): one edit can never jump the type more
    // than 2× — current 80px caps at 160, NOT the absolute 400 ceiling.
    expect(r.diff[0].patch.defaultConfig.fontSize).toBe(160);
    expect(r.diff[0].patch.defaultConfig.color).toBe('var(--brand-primary)');
    expect(r.unresolved).toContain('make it sparkle');
  });

  it('validateChatEditDiff: naked fontSize on an auto-sizing engine board is REFUSED with a helpful note (the 2026-07-20 blowup class)', () => {
    // STADIUM_MEET_BOARD-style zone: rich config, NO zone-level fontSize.
    const zones = [{ id: 'z1', widgetType: 'STADIUM_MEET_BOARD', defaultConfig: { headerText: 'GIRLS 100M FREESTYLE', recordTime: '50.84' } }];
    const r = validateChatEditDiff({ edits: [{ zoneId: 'z1', fontSize: 72 }] }, zones);
    expect(r.diff.length).toBe(0); // no patch — the board's base scale is untouchable
    expect(r.unresolved.some((u: string) => /sizes its text automatically/.test(u))).toBe(true);
  });

  it('validateChatEditDiff: named FIELDS edit rich-board config keys with target-labelled summaries; blocked/unknown keys dropped', () => {
    const zones = [{
      id: 'z1', widgetType: 'STADIUM_MEET_BOARD',
      defaultConfig: { headerText: 'GIRLS 100M FREESTYLE', recordTime: '50.84', sponsorName: 'River Dental', boardUrl: '/templates/x.html', laneCount: 6 },
    }];
    const r = validateChatEditDiff({
      edits: [{ zoneId: 'z1', fields: {
        headerText: 'GIRLS 200M MEDLEY',
        recordTime: '49.99',
        laneCount: 8,
        boardUrl: 'https://evil.example',   // blocked key pattern (url) — dropped
        notARealKey: 'nope',                // not in the zone's config — dropped
      } }],
    }, zones);
    expect(r.diff.length).toBe(1);
    const cfg = r.diff[0].patch.defaultConfig;
    expect(cfg.headerText).toBe('GIRLS 200M MEDLEY');
    expect(cfg.recordTime).toBe('49.99');
    expect(cfg.laneCount).toBe(8);
    expect(cfg.boardUrl).toBeUndefined();
    expect(cfg.notARealKey).toBeUndefined();
    // Proposal card names every target — no bare "Size → 72px" orphans.
    expect(r.diff[0].summary.some((s: string) => s.startsWith('Header text →'))).toBe(true);
    expect(r.diff[0].summary.some((s: string) => s.startsWith('Record time →'))).toBe(true);
  });

  it('chatEditableFieldKeys: exposes primitive content keys, blocks url/code/id-ish keys', () => {
    const keys = chatEditableFieldKeys({
      headerText: 'x', recordTime: '50.84', laneCount: 6,
      boardUrl: '/x', imageSrc: '/y', apiToken: 'z', screenId: 'a',
      nested: { no: true }, flag: true,
    });
    expect(keys).toEqual(expect.arrayContaining(['headerText', 'recordTime', 'laneCount']));
    for (const bad of ['boardUrl', 'imageSrc', 'apiToken', 'screenId', 'nested', 'flag']) {
      expect(keys).not.toContain(bad);
    }
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
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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

// ── Whole-board TRANSLATE (2026-07-05) ──
// B11 dead-end fix (2026-08-24) — packaged EXTERNAL_HTML boards send their
// [data-field] inventory as `chatFields`; field edits must route into the
// textOverrides transport (what the panel + in-board shim already use), and
// everything zone-wide must be refused HONESTLY (an emitted no-op patch would
// read as success on the review card).
describe('AiService — Slice 2a chat-to-edit on DESIGNED BOARDS (chatFields)', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  const boardZone = {
    id: 'ext1',
    widgetType: 'EXTERNAL_HTML',
    defaultConfig: {
      url: '/templates/hs/welcome.html',
      textOverrides: { 'hero.sub': 'Go Eagles' },
    },
    chatFields: [
      { key: 'hero.title', label: 'Hero title', value: 'WELCOME BACK' },
      { key: 'hero.sub', label: 'Hero subtitle', value: 'Go Eagles' },
    ],
  };

  it('routes field edits into a MERGED textOverrides map with label-named summaries', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', fields: { 'hero.title': 'FRIDAY NIGHT LIGHTS' } }] },
      [boardZone],
    );
    expect(r.diff).toHaveLength(1);
    expect(r.diff[0].patch.defaultConfig.textOverrides).toEqual({
      'hero.sub': 'Go Eagles', // pre-existing override preserved
      'hero.title': 'FRIDAY NIGHT LIGHTS',
    });
    // Summary names the target by its friendly label — never a bare value.
    expect(r.diff[0].summary.join(' ')).toContain('Hero title');
    // No zone-level keys may leak onto a designed board's patch.
    expect(Object.keys(r.diff[0].patch)).toEqual(['defaultConfig']);
  });

  it('compound instruction → multiple field entries land in ONE patch', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', fields: { 'hero.title': 'HOMECOMING', 'hero.sub': 'Friday 7pm' } }] },
      [boardZone],
    );
    expect(r.diff[0].patch.defaultConfig.textOverrides['hero.title']).toBe('HOMECOMING');
    expect(r.diff[0].patch.defaultConfig.textOverrides['hero.sub']).toBe('Friday 7pm');
    expect(r.diff[0].summary).toHaveLength(2);
  });

  it('unknown field keys are dropped (cannot reach undiscovered hooks)', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', fields: { 'not.a.hook': 'x' } }] },
      [boardZone],
    );
    expect(r.diff).toHaveLength(0);
  });

  it('zone-wide style keys (fontSize/color/text) are REFUSED with an honest note, never a no-op patch', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', fontSize: 72, color: '#ff0000', text: 'hi' }] },
      [boardZone],
    );
    expect(r.diff).toHaveLength(0);
    expect(r.unresolved.join(' ')).toContain('style controls');
  });

  it('geometry on a designed board is REFUSED with a layout note', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', y: 80, width: 50 }] },
      [boardZone],
    );
    expect(r.diff).toHaveLength(0);
    expect(r.unresolved.join(' ')).toContain('layout');
  });

  it('field values pass the plain-text sanitizer (tags stripped, dangerous schemes dropped)', () => {
    const r = validateChatEditDiff(
      { edits: [{ zoneId: 'ext1', fields: { 'hero.title': '<script>alert(1)</script>TACO <b>NIGHT</b>' } }] },
      [boardZone],
    );
    expect(r.diff[0].patch.defaultConfig.textOverrides['hero.title']).toBe('TACO NIGHT');
  });

  it('buildChatEditUserPrompt marks the zone DESIGNED BOARD and lists key + label + current value', () => {
    const p = buildChatEditUserPrompt('change the title', [boardZone]);
    expect(p).toContain('DESIGNED BOARD');
    expect(p).toContain('hero.title');
    expect(p).toContain('Hero title');
    expect(p).toContain('WELCOME BACK');
    // Regular zones keep the classic line shape (regression guard).
    const p2 = buildChatEditUserPrompt('x', [
      { id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Hi', fontSize: 48 } },
    ]);
    expect(p2).toContain('zoneId z1 (TEXT)');
    expect(p2).not.toContain('DESIGNED BOARD');
  });

  it('normalizeChatFields dedupes, drops junk, and caps at 48', () => {
    const raw = [
      { key: 'a', label: 'A', value: '1' },
      { key: 'a', label: 'dup', value: '2' },
      { key: '', value: 'no key' },
      'garbage',
      ...Array.from({ length: 60 }, (_, i) => ({ key: `k${i}` })),
    ];
    const out = normalizeChatFields(raw);
    expect(out).toHaveLength(48);
    expect(out[0]).toEqual({ key: 'a', label: 'A', value: '1' });
    expect(out.filter((f) => f.key === 'a')).toHaveLength(1);
  });
});

describe('AiService — whole-board translate', () => {
  beforeEach(() => {
    delete process.env.AI_FREE_TIER_CAP;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('rejects an unsupported language at the boundary — no provider call', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.translateBoard({
        tenantId: 't1',
        targetLang: 'xx',
        zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Welcome' } }],
      }),
    ).rejects.toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('rejects a board with no editable text — no provider call', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await expect(
      service.translateBoard({
        tenantId: 't1',
        targetLang: 'es',
        zones: [{ id: 'c1', widgetType: 'CLOCK', defaultConfig: {} }],
      }),
    ).rejects.toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('is TEXT-ONLY: strips any geometry/style the model tries to sneak in', async () => {
    // Model returns a translation PLUS a font-size bump, a move, and a colour —
    // the translate post-filter must keep ONLY the translated text.
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({ edits: [{ zoneId: 'z1', text: 'Bienvenidos', fontSize: 200, x: 50, color: 'brand red' }] }),
    });
    const { service } = buildService(makeFakeRedisClient());
    const r = await service.translateBoard({
      tenantId: 't1',
      targetLang: 'es',
      zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Welcome', fontSize: 80 } }],
    });
    expect(r.diff.length).toBe(1);
    expect(r.diff[0].patch).toEqual({ defaultConfig: { content: 'Bienvenidos' } }); // text ONLY
    expect(r.diff[0].patch.fontSize).toBeUndefined();
    expect(r.diff[0].patch.x).toBeUndefined();
    expect(r.diff[0].patch.defaultConfig.color).toBeUndefined();
    expect(r.targetLangLabel).toBe('Spanish');
  });

  it('translates the WHOLE board — more than chat-edit’s 12-zone cap', async () => {
    // 20 text zones — the regression guard for the maxEdits=40 fix. Before it,
    // validateChatEditDiff sliced to 12 and left 8 zones un-translated.
    const zones = Array.from({ length: 20 }, (_, i) => ({
      id: `z${i}`,
      widgetType: 'TEXT',
      defaultConfig: { content: `Item ${i}` },
    }));
    dispatchMock.mockResolvedValue({
      raw: JSON.stringify({ edits: zones.map((z, i) => ({ zoneId: z.id, text: `Artículo ${i}` })) }),
    });
    const { service } = buildService(makeFakeRedisClient());
    const r = await service.translateBoard({ tenantId: 't1', targetLang: 'es', zones });
    expect(r.translated).toBe(20);
    expect(r.diff.length).toBe(20);
    expect(r.diff.every((d: any) => /^Artículo /.test(d.patch.defaultConfig.content))).toBe(true);
  });

  it('records exactly one success slot and writes an AI_TRANSLATE_BOARD audit row', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [{ zoneId: 'z1', text: 'Hola' }] }) });
    const fake = makeFakeRedisClient();
    const { service } = buildService(fake);
    await service.translateBoard({
      tenantId: 't1',
      targetLang: 'es',
      zones: [{ id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Hi' } }],
    });
    expect(fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1').length).toBe(1);
    expect(auditRows.some((r) => r.action === 'AI_TRANSLATE_BOARD')).toBe(true);
  });
});

// ── Slice 1b — per-tenant brand voice + chat-edit add/delete intent ──
describe('AiService — Slice 1b brand voice + add/delete intent', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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

  // REGRESSION (live beta 2026-06-26; W0-03 2026-07-13): the FE/enum
  // carries orientation as the legacy DALL-E size vocabulary (1792x1024 /
  // 1024x1792), but the gpt-image family ONLY accepts 1024x1024 /
  // 1536x1024 / 1024x1536 and 400s on a DALL-E size ("Invalid size
  // '1792x1024'…"). callOpenAiImage must re-map the requested orientation
  // to the gpt-image vocabulary before sending.
  it('OpenAI best image model first (gpt-image-2.5-sunburst) → landscape 1792x1024 is re-mapped to 1536x1024', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'wide stadium banner', size: '1792x1024' });
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.model).toBe('gpt-image-2.5-sunburst');
    expect(reqBody.size).toBe('1536x1024'); // gpt-image vocabulary, NOT the DALL-E 1792x1024
  });

  it('OpenAI gpt-image-2 → portrait 1024x1792 is re-mapped to 1024x1536 in the request body', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'tall poster', size: '1024x1792' });
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.size).toBe('1024x1536'); // gpt-image vocabulary, NOT the DALL-E 1024x1792
  });

  it('image fallback chain → each model this account cannot use falls through to the next, same gpt-image sizes', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    // sunburst 403 (org gating) → gpt-image-2 404 → gpt-image-1 answers.
    fetchSpy
      .mockResolvedValueOnce(errResp(403, JSON.stringify({ error: { message: 'Your organization must be verified to use gpt-image-2.5-sunburst' } })))
      .mockResolvedValueOnce(errResp(404, JSON.stringify({ error: { message: 'The model gpt-image-2 does not exist' } })))
      .mockResolvedValueOnce(okJson({ data: [{ b64_json: TINY_PNG_B64 }] }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'wide banner', size: '1792x1024' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const models = fetchSpy.mock.calls.map((c: any[]) => JSON.parse(String(c[1].body)).model);
    expect(models).toEqual(['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1']);
    const fallbackBody = JSON.parse(String(fetchSpy.mock.calls[2][1].body));
    expect(fallbackBody.size).toBe('1536x1024'); // gpt-image vocabulary for every chain model
  });

  it('a SAFETY refusal is never retried down the chain (it would only be refused again)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    fetchSpy.mockResolvedValue(errResp(400, JSON.stringify({ error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } })));
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'x', size: '1024x1024' })).rejects.toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

  it('(e) Google (BYOK) tenant → gemini-3.1-flash-image generateContent and persists (imagen-4.0 dies 2026-08-17)', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'google', aiKeyEncrypted: 'enc', aiModel: 'gemini-2.5-flash' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('AIzaTestKey');
    // Image models interleave TEXT + IMAGE parts — the parser must scan
    // parts for inlineData, not read parts[0].
    fetchSpy.mockResolvedValue(okJson({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [
          { text: 'Here is your image.' },
          { inlineData: { mimeType: 'image/png', data: TINY_PNG_B64 } },
        ] },
      }],
    }));
    const { service, storage } = buildService(makeFakeRedisClient());
    const res = await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'sunset over a stadium', size: '1792x1024' });
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('gemini-3.1-flash-image:generateContent');
    expect(calledUrl).not.toContain(':predict'); // the dead imagen wire shape
    expect(calledUrl).not.toContain('AIzaTestKey'); // key rides the header, never the URL
    const reqBody = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(reqBody.contents[0].parts[0].text).toContain('sunset over a stadium');
    // Aspect ratio mapped from the landscape size.
    expect(reqBody.generationConfig.imageConfig.aspectRatio).toBe('16:9');
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ provider: 'google', id: 'asset_generated_1' });
  });

  it('(e2) Google safety-block (no image part) → actionable 503 with the block reason, nothing persisted', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'google', aiKeyEncrypted: 'enc', aiModel: 'gemini-2.5-flash' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('AIzaTestKey');
    fetchSpy.mockResolvedValue(okJson({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, candidates: [] }));
    const { service, storage } = buildService(makeFakeRedisClient());
    let caught: any;
    try {
      await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'something blocked' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(503);
    expect(String(caught.message)).toContain('PROHIBITED_CONTENT');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
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

  // S5 (2026-07-16) — a BYOK image tenant whose key can't be decrypted must
  // NOT silently fall through to the platform key. generateImage() throws
  // AI_KEY_UNREADABLE and never touches the provider / storage / DB.
  it('S5: BYOK image tenant + decrypt throws → AI_KEY_UNREADABLE, no fetch/upload/asset', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-4o-mini' });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'; // platform key set — the trap
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    const { service, storage } = buildService(makeFakeRedisClient());
    let caught: any;
    try {
      await service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'a blue mascot' });
    } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    expect(caught.getStatus()).toBe(503);
    expect(caught.getResponse()).toMatchObject({ code: 'AI_KEY_UNREADABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prismaMock.client.asset.create).not.toHaveBeenCalled();
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
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
    // gpt-image-2 500s (a 500 does NOT trigger the gpt-image-1 fallback —
    // only 404/403/400-model-missing do) → callOpenAiImage throws,
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
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
    tenantsById.set('t1', { id: 't1', aiProvider: 'anthropic', aiKeyEncrypted: 'enc', aiModel: 'claude-haiku-4-5' });
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
// The operator-facing part of a Designer user message. Since 2026-09-22 the
// message opens with REFERENCE BOARDS (another business's approved boards —
// their dishes include "fries"); what THIS board was given starts at "THIS BOARD".
const thisBoard = (userPrompt: string) => userPrompt.slice(userPrompt.indexOf('THIS BOARD'));
// Resolved-menu rows in the exact shape MenuService.resolveMenuForLocation returns.
const ITEM_BURGER = { id: 'h1', externalId: null, name: 'burger', description: null, priceCents: 299, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false };
const ITEM_FRIES = { id: 'h2', externalId: null, name: 'fries', description: null, priceCents: 300, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false };
const ITEM_SHAKE = { id: 'h3', externalId: null, name: 'shake', description: null, priceCents: 500, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false };
const ITEM_POS_1 = { id: 'p1', externalId: 'sq-ITEM-1', name: 'Carne Asada Burrito', description: null, priceCents: 1150, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false };
const ITEM_POS_2 = { id: 'p2', externalId: 'sq-ITEM-2', name: 'Horchata', description: null, priceCents: 350, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false };

describe('AiService — AI Designer HTML candidates', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

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
    // Every dispatchAi call (the brief-extraction pass + the 3 board calls)
    // returns the same fakeBoard here. The extraction call's reply is HTML,
    // not JSON, so parseDesignerBrief returns null — proving the #268
    // interpretation-hedging pass degrades to "no brief" without touching the
    // 3 real board calls' outcome (never blocks generation on a bad parse).
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
    // #268 item 2 — ONE extra call for the brief-extraction pass BEFORE the
    // 3× fan-out (4 total), and it must NOT be recorded as a generation (see
    // the hourly-accounting assertion below).
    expect(dispatchMock).toHaveBeenCalledTimes(4);
    for (const c of res.candidates) {
      expect(c.html).toContain('<!doctype html>');
      expect(c.html).toContain('data-field="headline"');
      // W0-02: model-authored scripts (inline AND remote) are ALL stripped —
      // the platform injects its own trusted scale/fit runtime instead.
      expect(c.html).not.toContain('var s=1');
      expect(c.html).not.toMatch(/<script/i);
      expect(c.screenWidth).toBe(1920);
      expect(c.name).toBe('Chrome Coffee');
    }
    const successAdds = fake.zadd.mock.calls.filter((c) => c[0] === 'ai:rl:gen:t1');
    // Still exactly 3 — the brief-extraction call is NOT double-counted
    // against the hourly generation cap (economics decision, #268 item 2).
    expect(successAdds.length).toBe(3); // honest hourly accounting
    // The extraction call used a SHORT hard timeout independent of the
    // model's normal ceiling (dispatchAi's 4th positional arg carries it via
    // the timeoutMs field on the input object).
    const briefCall = dispatchMock.mock.calls.find((c) => c[1]?.maxTokens === 500);
    expect(briefCall?.[1]?.timeoutMs).toBe(18_000);
  });

  it('extracts a structured brief and shares it across all 3 candidates (interpretation hedging)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const briefJson = JSON.stringify({
      occasion: 'happy hour',
      headline: 'Happy Hour Every Friday',
      items: ['House Margarita — $6', 'Loaded Nachos — $9'],
      dateTime: 'Fridays 4-6pm',
      tone: 'playful',
      callToAction: 'Come thirsty',
    });
    dispatchMock.mockImplementation(async (_provider: any, input: any) => {
      // The extraction call is the one with the small maxTokens budget.
      if (input.maxTokens === 500) return { raw: briefJson };
      return { raw: fakeBoard };
    });
    const { service } = buildService(fake);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'happy hour board',
      vertical: 'bar',
    });

    // Every board-generation call (not the extraction call) must carry the
    // confirmed brief text in its user prompt, AND a distinct LAYOUT per
    // candidate (2026-09-22: per-purpose structures replaced the art
    // directions + content emphases).
    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    expect(boardCalls).toHaveLength(3);
    const layouts = new Set<string>();
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('CONFIRMED BRIEF');
      expect(input.userPrompt).toContain('Happy Hour Every Friday');
      expect(input.userPrompt).toContain('House Margarita — $6');
      const m = input.userPrompt.match(/LAYOUT FOR THIS OPTION — ([^:]+):/);
      expect(m).toBeTruthy();
      layouts.add(m![1]);
    }
    expect(layouts.size).toBe(3); // three different layouts, never three moods of one

    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    const details = JSON.parse(auditRow.details);
    expect(details.briefExtracted).toBe(true);
    expect(details.briefUsed).toBe(true);
    expect(details.briefSource).toBe('extracted');
  });

  it('accepts a client-confirmed brief and skips a fresh extraction call (no double-count)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockResolvedValue({ raw: fakeBoard });
    const { service } = buildService(fake);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'happy hour board',
      vertical: 'bar',
      brief: {
        occasion: 'happy hour',
        headline: 'Client-Confirmed Headline',
        items: ['Draft Beer — $4'],
        dateTime: '',
        tone: 'playful',
        callToAction: '',
      },
    });

    // No maxTokens:500 extraction call at all — exactly 3 board calls.
    expect(dispatchMock).toHaveBeenCalledTimes(3);
    expect(dispatchMock.mock.calls.every((c) => c[1]?.maxTokens !== 500)).toBe(true);
    for (const [, input] of dispatchMock.mock.calls) {
      expect(input.userPrompt).toContain('Client-Confirmed Headline');
    }

    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    const details = JSON.parse(auditRow.details);
    expect(details.briefExtracted).toBe(false); // no extraction call ran
    expect(details.briefUsed).toBe(true);
    expect(details.briefSource).toBe('client');
  });

  it('a malformed/garbage extraction reply never blocks generation (best-effort fallback)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockImplementation(async (_provider: any, input: any) => {
      if (input.maxTokens === 500) return { raw: 'not json at all {{{' };
      return { raw: fakeBoard };
    });
    const { service } = buildService(fake);

    const res = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'happy hour board',
    });
    expect(res.candidates).toHaveLength(3);
    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    const details = JSON.parse(auditRow.details);
    expect(details.briefExtracted).toBe(false);
    expect(details.briefUsed).toBe(false);
    expect(details.briefSource).toBe('none');
  });

  it('a provider ERROR on the extraction call never blocks generation (best-effort fallback)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    dispatchMock.mockImplementation(async (_provider: any, input: any) => {
      if (input.maxTokens === 500) return { raw: '', errorStatus: 500, errorBody: 'boom' };
      return { raw: fakeBoard };
    });
    const { service } = buildService(fake);

    const res = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'happy hour board',
    });
    expect(res.candidates).toHaveLength(3);
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

// ═══════════════════════════════════════════════════════════════════════════
// #268 item 5 — AUTO-GROUND WITH TENANT DATA. Read-only, hard-truncated,
// never fabricates. Menu grounding uses MenuService (mocked); address
// grounding reads Tenant.address directly.
// ═══════════════════════════════════════════════════════════════════════════
describe('AiService — AI Designer auto-ground with tenant data (#268 item 5)', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  const fakeBoard = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Board</h1><script>var s=1;</script></div></body></html>';

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({ raw: fakeBoard });
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null, name: 'Chrome Coffee', address: '123 Main St, Springfield' });
  });

  it('grounds a menu-ish brief with the venue\'s REAL live-priced POS items', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = {
      resolveMenuForLocation: jest.fn(),
      resolvePosMenuForLocation: jest.fn(async () => ({
        locationTenantId: 't1',
        generatedAt: new Date().toISOString(),
        categories: [],
        items: [
          { id: 'i1', externalId: null, name: 'Cortado', description: null, priceCents: 450, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false },
          { id: 'i2', externalId: null, name: 'Flat White', description: null, priceCents: 500, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 1, available: true, soldOut: false },
        ],
      })),
    };
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'menu board with our drinks',
      vertical: 'qsr',
    });

    expect(menuMock.resolvePosMenuForLocation).toHaveBeenCalledWith('t1');
    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled(); // never the whole price book
    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('Cortado');
      expect(input.userPrompt).toContain('$4.50');
      expect(input.userPrompt).toContain('live POS menu');
    }
    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    expect(JSON.parse(auditRow.details).autoGrounded).toBe(true);
  });

  it('does NOT ground when the operator already supplied content (never overrides real input)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = {
      resolveMenuForLocation: jest.fn(async () => ({
        locationTenantId: 't1', generatedAt: new Date().toISOString(), categories: [],
        items: [{ id: 'i1', externalId: null, name: 'Cortado', description: null, priceCents: 450, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false }],
      })),
    };
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'menu board',
      vertical: 'qsr',
      content: 'Espresso 3.50', // operator already supplied content
    });

    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('Espresso 3.50');
      expect(thisBoard(input.userPrompt)).not.toContain('Cortado');
    }
  });

  // ── THE OPERATOR POINTED ELSEWHERE (2026-09-22) ─────────────────────────
  // Greg pasted supertacomex.com (no readable menu — prices live in Toast's
  // ordering app) and asked for its menu. Three hand-typed test rows in his
  // account's price book went on every board. A hand-entered price book no
  // longer stands in for the menu the operator explicitly pointed us at; a
  // catalog SYNCED FROM A LIVE POS still does.
  const handTyped = [ITEM_BURGER, ITEM_FRIES, ITEM_SHAKE];
  const posSynced = [ITEM_POS_1, ITEM_POS_2];
  // The account's WHOLE saved menu (hand-built rows included) vs the POS-synced part of it.
  const menuOf = (saved: any[], pos: any[] = []) => ({
    resolveMenuForLocation: jest.fn(async () => ({ locationTenantId: 't1', generatedAt: new Date().toISOString(), categories: [], items: saved })),
    resolvePosMenuForLocation: jest.fn(async () => ({ locationTenantId: 't1', generatedAt: new Date().toISOString(), categories: [], items: pos })),
  });

  it('a PHOTO of a printed menu becomes the reference\'s menu, and the summary leads with it', async () => {
    const photoMenu = { sections: [{ name: 'Burritos', items: [{ name: 'Super Burrito', price: '$12.99' }] }], itemCount: 1, source: { url: 'uploaded photo', method: 'photo' as const } };
    const { service, altText } = buildService(makeFakeRedisClient());
    altText.analyzeDesignReference.mockResolvedValueOnce({ summary: 'Hand-painted taqueria board.', palette: ['#e2452a'], menu: photoMenu, provider: 'anthropic', model: 'claude-haiku-4-5' });

    const ref: any = await service.analyzeDesignReferenceImage({ tenantId: 't1', imageBuffer: Buffer.from([1]), mimeType: 'image/jpeg', filename: 'menu.jpg' });

    expect(ref.menu).toEqual(photoMenu);
    expect(ref.summary.startsWith('Menu read off the uploaded photo: 1 item in 1 section (Burritos).')).toBe(true);
    expect(ref.summary).toContain('Hand-painted taqueria board.');
  });

  it('siteMenuMissing + a HAND-ENTERED price book → the rows stay off the board', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const menuMock = menuOf(handTyped);
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1', prompt: 'a menu board for Super Taco with prices from our website', vertical: 'qsr', siteMenuMissing: true,
    });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    expect(boardCalls.length).toBeGreaterThan(0);
    for (const [, input] of boardCalls) {
      expect(thisBoard(input.userPrompt)).not.toMatch(/burger|fries|shake/i);
      expect(thisBoard(input.userPrompt)).not.toContain('Real menu items');
    }
    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    expect(JSON.parse(auditRow.details).autoGrounded).toBe(false);
  });

  it('siteMenuMissing + a catalog SYNCED FROM A LIVE POS → still grounds (it IS the venue\'s menu)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const menuMock = menuOf([...handTyped, ...posSynced], posSynced);
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'menu board', vertical: 'qsr', siteMenuMissing: true });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('Carne Asada Burrito');
      expect(input.userPrompt).toContain('$11.50');
    }
  });

  it('a HAND-ENTERED price book never grounds a board on its own — with or without a website (the test-menu bug)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    // shaped like what the console writes: every hand-typed row HAS an externalId
    const pasted = handTyped.map((it, i) => ({ ...it, externalId: `pasted-${it.name}-${i}` }));
    const menuMock = menuOf(pasted, []);
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);

    // "standard Mexican food items" — no website, no content: exactly Greg's 2026-09-22 run
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'create a menu board using standard Mexican food items', vertical: 'qsr' });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    expect(boardCalls.length).toBeGreaterThan(0);
    for (const [, input] of boardCalls) {
      expect(thisBoard(input.userPrompt)).not.toMatch(/burger|fries|shake|\$2\.99/i);
      expect(thisBoard(input.userPrompt)).not.toContain('Real menu items');
    }
    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
    expect(JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details).autoGrounded).toBe(false);
  });

  it('the operator EXPLICITLY picks their saved menu (menuSource: saved) → it grounds, labelled as their choice', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const menuMock = menuOf(handTyped, []);
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'menu board', vertical: 'qsr', menuSource: 'saved' });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('burger');
      expect(input.userPrompt).toContain('the operator chose from their saved menu');
      expect(thisBoard(input.userPrompt)).not.toContain('live POS menu');
    }
  });

  it('menuSource: none grounds nothing from the menu, even a POS menu', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const menuMock = menuOf(posSynced, posSynced);
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'menu board', vertical: 'qsr', menuSource: 'none' });

    expect(menuMock.resolvePosMenuForLocation).not.toHaveBeenCalled();
    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
  });

  it('does NOT ground a non-menu-ish brief (no keyword/vertical signal)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = menuOf([], []);
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'a welcome board for our lobby',
      vertical: 'corporate',
    });

    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
    expect(menuMock.resolvePosMenuForLocation).not.toHaveBeenCalled();
  });

  it('never fabricates — an empty tenant catalog grounds nothing (no menu items invented)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = menuOf([], []);
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'happy hour menu board', vertical: 'bar' });

    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    expect(JSON.parse(auditRow.details).autoGrounded).toBe(false);
  });

  it('a menu-lookup failure is best-effort — never blocks generation', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = { resolveMenuForLocation: jest.fn(), resolvePosMenuForLocation: jest.fn(async () => { throw new Error('db hiccup'); }) };
    const { service } = buildService(fake, undefined, undefined, menuMock);

    const res = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'menu board', vertical: 'qsr' });
    expect(res.candidates).toHaveLength(3);
  });

  it('grounds an address-ish brief with the tenant\'s REAL address (never invents one)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const { service } = buildService(fake);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'a board showing our location and directions to find us',
      vertical: 'corporate',
    });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    for (const [, input] of boardCalls) {
      expect(input.userPrompt).toContain('123 Main St, Springfield');
    }
  });

  it('grounding output is hard-truncated (never balloons the prompt)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const manyItems = Array.from({ length: 50 }, (_, i) => ({
      id: `i${i}`, externalId: null, name: `Item Number ${i} With A Long Descriptive Name`, description: null,
      priceCents: 999, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null,
      sortOrder: i, available: true, soldOut: false,
    }));
    const menuMock = menuOf(manyItems, manyItems);
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'menu board with lots of items', vertical: 'qsr' });

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    // Only the first 12 items should appear — never the full 50-item catalog.
    expect(boardCalls[0][1].userPrompt).toContain('Item Number 0');
    expect(boardCalls[0][1].userPrompt).not.toContain('Item Number 49');
  });

  // ── THE SITE MENU OUTRANKS THE TENANT CATALOG (2026-09-22 incident) ──────
  //
  // Greg pasted his restaurant's website into the Concierge and asked for a
  // menu board. The boards came back carrying `burger $2.99 / fries $3.00 /
  // shake $5.00` — his tenant's TEST price book — because nobody supplied any
  // `content`, so auto-grounding reached into the catalog and found it.
  //
  // The short-circuit that prevents this has always existed ("grounding only
  // fills a GAP"). What changed is that it is now LOAD-BEARING: the menu read
  // off the operator's own site arrives as `content`. These pin it, including
  // for a POS-SYNCED catalog, which is the one case where someone might argue
  // the catalog is fresher — it still loses, because the operator pasted THAT
  // URL for THIS board, and two price sources on one board puts two different
  // prices for the same item on a wall.
  const TEST_PRICE_BOOK = [
    { id: 'i1', externalId: 'sq_1', name: 'burger', description: null, priceCents: 299, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 0, available: true, soldOut: false },
    { id: 'i2', externalId: 'sq_2', name: 'fries', description: null, priceCents: 300, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 1, available: true, soldOut: false },
    { id: 'i3', externalId: 'sq_3', name: 'shake', description: null, priceCents: 500, priceOverridden: false, imageUrl: null, allergens: [], tags: [], category: null, categoryId: null, sortOrder: 2, available: true, soldOut: false },
  ];
  // The exact string the web's buildMenuContentFromReferences emits.
  const SITE_MENU_CONTENT = [
    "REAL MENU from the venue's own website (supertaco.example). 3 items across 2 sections. Every row below is theirs: put ALL of them on the board, names and prices exactly as written, and invent nothing.",
    'Tacos — Al Pastor — $4.25 — marinated pork, pineapple',
    'Tacos — Carnitas — $4.25',
    'Drinks — Horchata — $3',
  ].join('\n');

  it('never touches the tenant catalog when the operator supplied a site menu', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    // POS-SYNCED — still loses to the pasted site.
    const menuMock = menuOf(TEST_PRICE_BOOK, TEST_PRICE_BOOK);
    const { service } = buildService(fake, undefined, undefined, menuMock);

    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'menu board — pull the items from my website',
      vertical: 'qsr',
      content: SITE_MENU_CONTENT,
    });

    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
    expect(menuMock.resolvePosMenuForLocation).not.toHaveBeenCalled();

    const boardCalls = dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
    expect(boardCalls.length).toBeGreaterThan(0);
    for (const [, input] of boardCalls) {
      // Every real row reached the model…
      expect(input.userPrompt).toContain('Tacos — Al Pastor — $4.25 — marinated pork, pineapple');
      expect(input.userPrompt).toContain('Tacos — Carnitas — $4.25');
      expect(input.userPrompt).toContain('Drinks — Horchata — $3');
      // …and not one row of the test price book did.
      expect(thisBoard(input.userPrompt)).not.toContain('$2.99');
      expect(thisBoard(input.userPrompt)).not.toContain('$3.00');
      expect(thisBoard(input.userPrompt)).not.toContain('$5.00');
      expect(thisBoard(input.userPrompt)).not.toContain('live POS menu');
    }
    const auditRow = auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES');
    expect(JSON.parse(auditRow.details).autoGrounded).toBe(false);
  });

  it('grounds every site-menu price so the fact guard cannot strip them off the board', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const fake = makeFakeRedisClient();
    const menuMock = { resolveMenuForLocation: jest.fn(), resolvePosMenuForLocation: jest.fn() };
    const { service } = buildService(fake, undefined, undefined, menuMock);

    // A board that renders exactly what it was given must survive untouched.
    const pricedBoard = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
      + '<body><div class="stage"><div class="row"><span data-field="item.0.name">Al Pastor</span>'
      + '<span data-field="item.0.price">$4.25</span></div><div class="row"><span data-field="item.1.name">Horchata</span>'
      + '<span data-field="item.1.price">$3.00</span></div></div></body></html>';
    dispatchMock.mockResolvedValue({ raw: pricedBoard });

    const out = await service.generateDesignerBoardCandidates({
      tenantId: 't1', prompt: 'menu board', vertical: 'qsr', content: SITE_MENU_CONTENT,
    });

    for (const candidate of out.candidates) {
      expect(candidate.html).toContain('$4.25');
      expect(candidate.html).toContain('$3.00'); // "$3" in the content grounds "$3.00"
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AI DESIGNER REWORK (2026-09-22) — the board's own venue type, per-purpose
// layouts, reference boards, sample-menu mode, and whose brand voice applies.
// docs/research/2026-09-22-ai-designer-rework/01-*.md causes #3 #5 #6, 02 §4.
// ═══════════════════════════════════════════════════════════════════════════
describe('AiService — AI Designer rework: venue type, layouts, references, sample menu', () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  const board = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:relative;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Board</h1><p data-field="subhead">A board long enough to pass the length floor.</p></div></body></html>';
  const boardCalls = () => dispatchMock.mock.calls.filter((c) => c[1]?.maxTokens !== 500);
  const lastAudit = () => JSON.parse(auditRows.filter((r) => r.action === 'AI_DESIGNER_CANDIDATES').slice(-1)[0].details);

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    tenantsById.clear();
    brandingByTenant.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    dispatchMock.mockImplementation(async (_p: any, input: any) => (input.maxTokens === 500 ? { raw: 'no brief' } : { raw: board }));
    tenantsById.set('riot', { id: 'riot', name: 'RIOT Las Vegas Downtown', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    brandingByTenant.set('riot', { brandVoice: 'Bold, rebellious, all caps energy', displayName: 'RIOT' });
  });

  // THE INCIDENT SHAPE: a K-12 account (RIOT) designing a taqueria's menu.
  const TAQUERIA = {
    tenantId: 'riot',
    prompt: 'create a menu board using standard Mexican food items',
    vertical: 'k12',
    venueName: 'Super Taco',
    reference: 'Brand: Super Taco. What they are / sell (use this to pick the RIGHT content): "Authentic Mexican restaurant — tacos, burritos, aguas frescas".',
  };

  it('a restaurant board on a K-12 account gets the restaurant voice — never the K-12 audience clause', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates(TAQUERIA);
    expect(boardCalls()).toHaveLength(3);
    for (const [, input] of boardCalls()) {
      expect(input.system).not.toContain('K-12 school');
      expect(input.system).not.toContain("TODAY'S LUNCH");
      expect(input.system).toContain('full-service restaurant');
      expect(thisBoard(input.userPrompt)).toContain('venue type: restaurant');
      expect(thisBoard(input.userPrompt)).not.toMatch(/k12/i);
    }
    const audit = lastAudit();
    expect(audit).toMatchObject({ vertical: 'k12', boardVertical: 'RESTAURANT', boardVerticalSource: 'board' });
  });

  it('negative control: the same account\'s own school board keeps the K-12 voice', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 'riot', prompt: 'a welcome board for our students and parents on the first day of school', vertical: 'k12' });
    for (const [, input] of boardCalls()) expect(input.system).toContain('K-12 school');
    expect(lastAudit()).toMatchObject({ boardVertical: 'K12', boardVerticalSource: 'tenant' });
  });

  it('the tenant\'s brand voice stays off another business\'s board, and on its own', async () => {
    const { service } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates(TAQUERIA);
    for (const [, input] of boardCalls()) expect(input.system).not.toContain('BRAND VOICE');
    expect(lastAudit().brandVoiceApplied).toBe(false);

    dispatchMock.mockClear();
    await service.generateDesignerBoardCandidates({ tenantId: 'riot', prompt: 'a welcome board for our students', vertical: 'k12', venueName: 'RIOT' });
    for (const [, input] of boardCalls()) expect(input.system).toContain('BRAND VOICE');
    expect(lastAudit().brandVoiceApplied).toBe(true);
  });

  it('SAMPLE MENU: "standard Mexican food items" → generic names, empty price slots, no saved menu read', async () => {
    const menuMock = { resolveMenuForLocation: jest.fn(), resolvePosMenuForLocation: jest.fn() };
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);
    await service.generateDesignerBoardCandidates(TAQUERIA);
    expect(menuMock.resolvePosMenuForLocation).not.toHaveBeenCalled();
    expect(menuMock.resolveMenuForLocation).not.toHaveBeenCalled();
    for (const [, input] of boardCalls()) {
      expect(input.userPrompt).toContain('SAMPLE MENU — the operator asked for "standard Mexican food items"');
      expect(input.userPrompt).toContain('data-vos-sample-price="1">$ —</span>');
    }
    expect(lastAudit()).toMatchObject({ sampleMenu: true, purpose: 'menu', autoGrounded: false });
  });

  it('negative control: a menu request that is NOT a sample request still reads the POS menu', async () => {
    const menuMock = { resolveMenuForLocation: jest.fn(), resolvePosMenuForLocation: jest.fn(async () => ({ items: [] })) };
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, menuMock);
    await service.generateDesignerBoardCandidates({ tenantId: 'riot', prompt: 'a menu board with our tacos', vertical: 'qsr' });
    expect(menuMock.resolvePosMenuForLocation).toHaveBeenCalled();
    for (const [, input] of boardCalls()) expect(input.userPrompt).not.toContain('SAMPLE MENU');
    expect(lastAudit().sampleMenu).toBe(false);
  });

  it('each candidate builds a different layout for the purpose, and the pick grid gets their names', async () => {
    const { service } = buildService(makeFakeRedisClient());
    const out = await service.generateDesignerBoardCandidates({ tenantId: 'riot', prompt: 'taco tuesday', purpose: 'promo', vertical: 'qsr', venueName: 'Casa Lupita' });
    expect(out.candidates.map((c) => c.structure)).toEqual(['split-offer', 'headline-poster', 'offer-stack']);
    expect(out.candidates.map((c) => c.artDirection)).toEqual(['Photo + offer', 'Headline poster', 'Lead offer + more']);
    const layouts = boardCalls().map(([, input]) => (input.userPrompt.match(/LAYOUT FOR THIS OPTION — ([^:]+):/) || [])[1]);
    expect(layouts).toEqual(['PHOTO + OFFER', 'HEADLINE POSTER', 'LEAD OFFER + MORE']);
    expect(lastAudit()).toMatchObject({ purpose: 'offer', structures: ['split-offer', 'headline-poster', 'offer-stack'] });
  });

  it('shows approved reference boards for a menu — to every venue, the one a board was first made for included', async () => {
    const { service } = buildService(makeFakeRedisClient());
    const rows = 'Tacos — Al Pastor — $4.25\nTacos — Carnitas — $4.25\nDrinks — Horchata — $3';
    await service.generateDesignerBoardCandidates({ tenantId: 'riot', prompt: 'menu board', vertical: 'qsr', venueName: 'Casa Lupita', content: rows, purpose: 'menu' });
    for (const [, input] of boardCalls()) {
      expect(input.userPrompt.startsWith('REFERENCE BOARDS')).toBe(true);
      expect(input.userPrompt).toContain('THIS BOARD IS THE MENU — the content above has 3 items.');
    }
    const shown = lastAudit().exemplars as string[][];
    expect(shown).toHaveLength(3);
    expect(shown[0]).toEqual(['menu-rail-cards', 'menu-hero-cards']); // candidate 1 = rail + cards
    expect(shown[1]).toEqual(['menu-hero-cards', 'menu-rail-cards']); // candidate 2 = hero + cards

    // Super Taco — the business the wall was first made for — used to get NO
    // references. The boards carry placeholders now: it gets the same two per
    // candidate, and nothing on them names it or its dishes.
    dispatchMock.mockClear();
    await service.generateDesignerBoardCandidates({
      tenantId: 'riot',
      prompt: 'menu board',
      vertical: 'qsr',
      venueName: 'Super Taco',
      reference: 'Brand: Super Taco. What they are / sell: "Mexican restaurant".',
      content: rows,
      purpose: 'menu',
    });
    expect(boardCalls()).toHaveLength(3);
    for (const [, input] of boardCalls()) {
      expect(input.userPrompt.startsWith('REFERENCE BOARDS')).toBe(true);
      const references = input.userPrompt.slice(0, input.userPrompt.indexOf('THIS BOARD'));
      expect(references).not.toMatch(/super ?taco|birria|burrito|quesadilla|\$(?!0+\.00)\d/i);
      expect(thisBoard(input.userPrompt)).toContain('Super Taco');
    }
    expect(lastAudit().exemplars).toEqual(shown);
  });

  it('"edit with words" keeps the board\'s own venue type and keeps the binder attributes', async () => {
    const { service } = buildService(makeFakeRedisClient());
    const tacoBoard = board.replace('<h1 data-field="headline">Board</h1>', '<h1 data-field="headline">Super Taco — tacos, burritos and our Mexican restaurant menu</h1><div data-menu-row="0" data-pos-item="toast-1" data-seed="Carnitas Taco"><span data-field="item.0.name">Carnitas Taco</span></div>');
    await service.refineDesignerBoard({ tenantId: 'riot', html: tacoBoard, instruction: 'make the headline bigger', vertical: 'k12' });
    const [, input] = dispatchMock.mock.calls.slice(-1)[0];
    expect(input.system).not.toContain('K-12 school');
    expect(input.userPrompt).toMatch(/Venue type: (quick-service )?restaurant\./);
    expect(input.userPrompt).toContain('keep data-menu-row, data-pos-item, data-seed EXACTLY as they are');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// THE VERTICAL IS A DEFAULT, NOT AN INSTRUCTION (2026-08-25 incident).
//
// An operator on a QSR tenant chatted for 7 turns and got a board whose whole
// shape came from the tenant's `vertical` column — a priced combo menu, with
// "2 for $6, All Day" lifted verbatim out of the QSR playbook's GOLD examples.
// ─────────────────────────────────────────────────────────────────────────
describe('vertical voice — precedence + no gold-standard prices', () => {
  const { trimVerticalVoiceForBrief } = require('./ai.service');

  it('every vertical clause now carries an explicit precedence note', () => {
    const out = prependVoices('BASE', 'QSR', null);
    expect(out).toContain('PRECEDENCE');
    expect(out).toContain("The operator's own brief always outranks it");
    expect(out).toContain('never lift a price, number, date, or offer out of them');
  });

  it('ships NO literal currency amount in any vertical GOLD example', () => {
    // The exact leak: `GOLD: "2 for $6, All Day" / "New Spicy Chicken — $4.99"`.
    for (const v of ['QSR', 'BAR', 'RETAIL', 'RESTAURANT', 'FASHION', 'GYM', 'K12', 'VENUE']) {
      const clause = prependVoices('BASE', v, null).split('\n\n')[0];
      expect(clause).not.toMatch(/\$\d/);
    }
    expect(prependVoices('BASE', 'QSR', null)).not.toContain('2 for $6');
  });

  it('with a brief present, the vertical stops dictating CONTENT (no GOLD / ITEMS)', () => {
    const withBrief = prependVoices('BASE', 'QSR', null, { briefPresent: true });
    expect(withBrief).not.toContain('GOLD');
    expect(withBrief).not.toContain('ITEMS:');
    // …but it still sets VOICE, which is its real value.
    expect(withBrief).toContain('AUDIENCE');
    expect(withBrief).toContain('VOICE:');
    expect(withBrief).toContain('KICKERS:');
    expect(withBrief).toContain('BANNED:');
  });

  it('with NO brief, the full vertical playbook is untouched (empty-brief default preserved)', () => {
    const noBrief = prependVoices('BASE', 'QSR', null);
    expect(noBrief).toContain('GOLD');
    expect(noBrief).toContain('ITEMS:');
  });

  it('trimVerticalVoiceForBrief keeps unknown-shaped clauses intact (fail-safe)', () => {
    expect(trimVerticalVoiceForBrief('just a sentence with no labels')).toBe(
      'just a sentence with no labels',
    );
    expect(trimVerticalVoiceForBrief('')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GROUND-TRUTH LAW, end to end on the AI Designer path (2026-08-25 incident).
// The model is mocked to return EXACTLY the board the operator got: invented
// prices and a fabricated "2 for $6" deal on a brief that named no numbers.
// ─────────────────────────────────────────────────────────────────────────
describe('AiService — no invented prices reach a candidate board', () => {
  // Board design on OUR key needs an OpenAI (or Google) key since 2026-09-22 — it never falls
  // back to Claude. These suites are about the design flow, so our key includes one.
  beforeEach(() => { process.env.OPENAI_API_KEY = 'sk-openai-platform'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  const pricedRow = (n: string, p: string) =>
    `<div class="row"><div class="nm" data-field="item.0.name">${n}</div><div class="dots"></div><div class="pr" data-field="item.0.price">${p}</div></div>`;
  const fabricatedBoard =
    '<!doctype html><html><head><style>.stage{width:1920px;height:1080px}</style></head><body>' +
    '<div class="stage"><h1 data-field="headline">Lunch, Handled</h1>' +
    '<div class="fit" data-fit-col>' +
    pricedRow('Burger', '$2.99') + pricedRow('Fries', '$3.00') + pricedRow('Shake', '$5.00') +
    '</div>' +
    '<div class="badge"><div>DEAL</div><div>2 for $6</div><div>All Day</div></div>' +
    '</div></body></html>';

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
  });

  it('strips every fabricated price + the invented deal badge from all 3 candidates', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: fabricatedBoard });
    const { service } = buildService(makeFakeRedisClient());

    const res = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'a lunch board for our counter — bright and friendly',
      vertical: 'qsr',
    });

    expect(res.candidates).toHaveLength(3);
    for (const c of res.candidates) {
      expect(c.html).not.toMatch(/\$\d/);       // not one currency value survives
      expect(c.html).not.toContain('Burger');   // the whole fabricated row is gone
      expect(c.html).not.toContain('2 for');    // the deal badge is gone
      expect(c.html).toContain('Lunch, Handled'); // real copy survives
      expect(c.html).toContain('Add your items and prices'); // honest empty state
    }
  });

  it('audits the refusal so an invented-price attempt is never silent', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: fabricatedBoard });
    const { service } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'lunch board', vertical: 'qsr' });

    const details = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(details.ungroundedClaimsDropped.sort()).toEqual(['$2.99', '$3.00', '$5.00', '$6']);
  });

  it('KEEPS prices the operator actually gave us in the brief', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    dispatchMock.mockResolvedValue({ raw: fabricatedBoard });
    const { service } = buildService(makeFakeRedisClient());

    const res = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'lunch board — burger 2.99, fries 3.00, shake 5.00, and a 2 for 6 deal',
      vertical: 'qsr',
    });

    for (const c of res.candidates) {
      expect(c.html).toContain('$2.99');
      expect(c.html).toContain('$3.00');
      expect(c.html).toContain('$5.00');
      expect(c.html).toContain('2 for $6');
      expect(c.html).not.toContain('Add your items and prices');
    }
    const details = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(details.ungroundedClaimsDropped).toEqual([]);
  });
});

// ── 2026-09-22 — model choice is catalog data, spend is metered in dollars ─────────────────
describe('AiService — model per JOB, dollar-metered allowance', () => {
  const board = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Chrome Coffee</h1></div></body></html>';

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    const { setCatalogState } = require('./ai-model-catalog');
    setCatalogState({});
  });
  afterEach(() => jest.restoreAllMocks());

  it('OUR key: the brief read is a fast job (Haiku 4.5), the 3 boards are the design job (GPT-6 Sol), each metered as its own row', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    process.env.OPENAI_API_KEY = 'sk-openai-platform';
    dispatchMock.mockImplementation(async (_p: any, input: any) =>
      input.maxTokens === 500 ? { raw: '{}', model: input.model } : { raw: board, model: input.model, durationMs: 42, usage: { inputTokens: 9000, outputTokens: 7000 } },
    );
    const { service, meter } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu', vertical: 'qsr' });
    const brief = dispatchMock.mock.calls.find((c) => c[1].maxTokens === 500)![1];
    expect(brief).toMatchObject({ model: 'claude-haiku-4-5', job: 'fast' });
    const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000).map((c) => c[1]);
    expect(boards).toHaveLength(3);
    for (const b of boards) {
      expect(b).toMatchObject({ model: 'gpt-6-sol', job: 'design' });
      // a refused design model degrades to the previous verified version instead of failing the board
      expect(b.fallbackModel).toBe('gpt-5.6-sol');
    }
    const features = meter.record.mock.calls.map((c: any[]) => c[0].feature).sort();
    expect(features).toEqual(['designer', 'designer', 'designer', 'designer-brief']);
    // per-board telemetry lands on the audit row
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(audit.model).toBe('gpt-6-sol');
    expect(audit.boards).toHaveLength(3);
    expect(audit.boards[0]).toMatchObject({ model: 'gpt-6-sol', ms: 42, outputTokens: 7000 });
    delete process.env.OPENAI_API_KEY;
  });

  it('an OWNER who deliberately lists a Claude tier for design gets it (a choice, never a default)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    require('./ai-model-catalog').setCatalogState({ platformRoutes: { design: [{ provider: 'anthropic', tier: 'premium' }] } });
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' });
    const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000);
    expect(boards.every((c) => c[1].model === 'claude-opus-5-5')).toBe(true);
  });

  it('the pre-route legacy setting (platformJobs.design) no longer puts Claude on design', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    require('./ai-model-catalog').setCatalogState({ platformJobs: { design: 'premium' } });
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_DESIGN_UNAVAILABLE' }),
    });
    expect(dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000)).toHaveLength(0);
  });

  it('OWN key: boards run on the tier the tenant chose (a saved gpt-5 is Premium → gpt-6-sol); chat runs on Standard', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-5' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service, meter } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' });
    const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000);
    expect(boards.every((c) => c[1].model === 'gpt-6-sol')).toBe(true);
    expect(dispatchMock.mock.calls.find((c) => c[1].maxTokens === 500)![1].model).toBe('gpt-6-luna');
    // metered for visibility, marked as the tenant's own key (never counted against the allowance)
    expect(meter.record.mock.calls.every((c: any[]) => c[0].source === 'tenant')).toBe(true);
  });

  it('a LOCATION with no key of its own designs on its ORGANISATION\'s key (GPT-6 Sol) — never our key, never Claude', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'; // our key is present — the trap
    tenantsById.set('riot', { id: 'riot', parentId: null, aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'gpt-5' });
    tenantsById.set('henderson', { id: 'henderson', parentId: 'riot', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-riot');
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service, meter } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 'henderson', prompt: 'coffee menu' });
    const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000);
    expect(boards).toHaveLength(3);
    expect(boards.every(([p, i]) => p === 'openai' && i.apiKey === 'sk-openai-riot' && i.model === 'gpt-6-sol')).toBe(true);
    expect(dispatchMock.mock.calls.every(([p]) => p === 'openai')).toBe(true);
    // the organisation's own key: metered for visibility, never against the included allowance
    expect(meter.record.mock.calls.every((c: any[]) => c[0].source === 'tenant' && c[0].tenantId === 'henderson')).toBe(true);
  });

  it('allowance used up → the ONE AI_CAP_REACHED 402, in credits, with the own-key way out — and no provider call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const allowance = {
      snapshot: jest.fn(async () => ({
        orgTenantId: 't1', screens: 2, includedMicros: 5_000_000, usedMicros: 5_000_001,
        includedCredits: 500, usedCredits: 501, resetAt: '2026-10-01T00:00:00.000Z', perScreenUsd: 2, floorUsd: 5,
      })),
    };
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, undefined, allowance);
    await expect(service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' })).rejects.toMatchObject({
      status: 402,
      response: expect.objectContaining({ code: 'AI_CAP_REACHED', cap: 500, used: 501, unit: 'credits' }),
    });
    await expect(service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' })).rejects.toMatchObject({
      response: expect.objectContaining({ message: expect.stringContaining('October 1') }),
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('getUsage reports the organisation allowance in credits, with screens', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const allowance = {
      snapshot: jest.fn(async () => ({
        orgTenantId: 't1', screens: 12, includedMicros: 24_000_000, usedMicros: 1_234_567,
        includedCredits: 2400, usedCredits: 124, resetAt: '2026-10-01T00:00:00.000Z', perScreenUsd: 2, floorUsd: 5,
      })),
    };
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, undefined, allowance);
    await expect(service.getUsage('t1')).resolves.toEqual({
      source: 'platform', used: 124, cap: 2400, resetAt: '2026-10-01T00:00:00.000Z', unit: 'credits', screens: 12, perScreenUsd: 2,
    });
  });

  it('OUR key refused a just-adopted model → the fallback answers AND the model is marked failed for every later call', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    const catalog = require('./ai-model-catalog');
    const spy = jest.spyOn(catalog, 'markModelFailed');
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'ok' }]), model: 'claude-haiku-4-5', failedModel: 'claude-haiku-5' });
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(spy).toHaveBeenCalledWith('anthropic', 'claude-haiku-5', expect.any(String));
  });

  it('a TENANT key refusing a model says nothing about the model — it is not marked failed', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'premium' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-test');
    const spy = jest.spyOn(require('./ai-model-catalog'), 'markModelFailed');
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'ok' }]), model: 'gpt-5.6-terra', failedModel: 'gpt-5.6-luna' });
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── 2026-09-22 — our key routes the DESIGN job to OpenAI (GPT-6 Sol) when we hold an OpenAI key ──
describe('AiService — our key: design on OpenAI, chat on Anthropic, never a key sent to the wrong vendor', () => {
  const board = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Chrome Coffee</h1></div></body></html>';

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    process.env.OPENAI_API_KEY = 'sk-openai-platform';
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    const cat = require('./ai-model-catalog');
    // the state the production sync wrote on 2026-09-22: GPT-6 Sol adopted for OpenAI Premium
    cat.setCatalogState({
      models: [{
        provider: 'openai', id: 'gpt-6-sol', label: 'GPT-6 Sol', family: 'gpt-sol', version: [6], releasedAt: '2026-09-22',
        inputPer1M: 2, outputPer1M: 10, status: 'unverified', retiresAt: null, source: 'feed',
        caps: { temperature: false, effort: 'openai-reasoning-effort', effortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasoning: true, maxOutputTokens: 128000, vision: true },
      }],
    });
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    require('./ai-model-catalog').setCatalogState({});
    jest.restoreAllMocks();
  });

  it('boards → OpenAI GPT-6 Sol with the OPENAI key (fallback GPT-5.6 Sol); the brief read → Anthropic Haiku with the ANTHROPIC key', async () => {
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service, meter } = buildService(makeFakeRedisClient());
    await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu', vertical: 'qsr' });
    const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000);
    expect(boards).toHaveLength(3);
    for (const [provider, input] of boards) {
      expect(provider).toBe('openai');
      expect(input).toMatchObject({ apiKey: 'sk-openai-platform', model: 'gpt-6-sol', fallbackModel: 'gpt-5.6-sol', job: 'design' });
    }
    const [briefProvider, brief] = dispatchMock.mock.calls.find((c) => c[1].maxTokens === 500)!;
    expect(briefProvider).toBe('anthropic');
    expect(brief).toMatchObject({ apiKey: 'sk-ant-platform', model: 'claude-haiku-4-5', job: 'fast' });
    // NO call ever pairs a vendor with another vendor's key
    for (const [provider, input] of dispatchMock.mock.calls) {
      expect(input.apiKey).toBe(provider === 'openai' ? 'sk-openai-platform' : 'sk-ant-platform');
    }
    // metered on OUR key (counts against the allowance) at the vendor that served it
    const designRows = meter.record.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e.feature === 'designer');
    expect(designRows.every((e: any) => e.provider === 'openai' && e.model === 'gpt-6-sol' && e.source === 'platform')).toBe(true);
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(audit).toMatchObject({ provider: 'openai', model: 'gpt-6-sol', source: 'platform' });
  });

  it('WITHOUT an OpenAI or Google key there is NO board design on our key — never a fall back to Claude', async () => {
    delete process.env.OPENAI_API_KEY;
    dispatchMock.mockImplementation(async (_p: any, input: any) => ({ raw: input.maxTokens === 500 ? '{}' : board, model: input.model }));
    const { service } = buildService(makeFakeRedisClient());
    const err = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' }).catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DESIGN_UNAVAILABLE' });
    // checked before anything is spent: no brief read, no board, and above all nothing on Claude
    expect(dispatchMock).not.toHaveBeenCalled();
    // …while the FAST jobs keep working on the Anthropic key (chat, copy, extraction)
    dispatchMock.mockResolvedValue({ raw: JSON.stringify([{ text: 'Spring sale' }]), model: 'claude-haiku-4-5' });
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(dispatchMock.mock.calls[0][0]).toBe('anthropic');
  });

  it('chat-to-edit changes a board\'s layout and style, so it is DESIGN work — GPT-6 Sol on our key, never Claude', async () => {
    dispatchMock.mockResolvedValue({ raw: JSON.stringify({ edits: [] }), model: 'gpt-6-sol' });
    const { service } = buildService(makeFakeRedisClient());
    await service
      .resolveChatEdit({ tenantId: 't1', instruction: 'make the headline red', zones: [{ id: 'z1', widgetType: 'TEXT', config: { text: 'Hi' } }] } as any)
      .catch(() => undefined);
    expect(dispatchMock).toHaveBeenCalled();
    const [provider, input] = dispatchMock.mock.calls[0];
    expect(provider).toBe('openai');
    expect(input).toMatchObject({ job: 'design', model: 'gpt-6-sol', apiKey: 'sk-openai-platform' });
  });

  it('chat (concierge) stays on Anthropic even when design runs on OpenAI', async () => {
    dispatchMock.mockReset();
    const msgs = require('./ai-providers');
    const spy = jest.spyOn(msgs, 'dispatchAiMessages').mockResolvedValue({ raw: JSON.stringify({ reply: 'hi', ready: false, intake: {} }), model: 'claude-haiku-4-5' });
    const { service } = buildService(makeFakeRedisClient());
    await service.conciergeChat({ tenantId: 't1', messages: [{ role: 'user', content: 'a menu board' }] } as any).catch(() => undefined);
    expect(spy).toHaveBeenCalled();
    const [provider, input] = spy.mock.calls[0] as any[];
    expect(provider).toBe('anthropic');
    expect(input).toMatchObject({ apiKey: 'sk-ant-platform', model: 'claude-haiku-4-5', job: 'fast' });
  });

  it('images NEVER run on our key — even now that our key can be an OpenAI key', async () => {
    const fetchSpy = jest.spyOn(globalThis as any, 'fetch');
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.generateImage({ tenantId: 't1', role: 'SCHOOL_ADMIN', prompt: 'a lion', size: '1024x1024' } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_IMAGE_UNAVAILABLE' }),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 2026-09-22 — our key: one-hop vendor failover, and never a vendor-account message ─────────
describe('AiService — our key: failover + the truth when our key is the problem', () => {
  const board = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0;background:#23282f;color:#fff}</style></head>'
    + '<body><div class="stage"><h1 data-field="headline">Chrome Coffee</h1></div></body></html>';
  const creditGone = { raw: '', errorStatus: 429, errorBody: '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}' };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
    process.env.OPENAI_API_KEY = 'sk-openai-platform';
    tenantsById.clear();
    auditRows.length = 0;
    dispatchMock.mockReset();
    tenantsById.set('t1', { id: 't1', aiProvider: null, aiKeyEncrypted: null, aiModel: null });
    require('./ai-model-catalog').setCatalogState({});
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    jest.restoreAllMocks();
  });

  it('our OpenAI key out of credit → the SAME board is drawn on our GOOGLE key (Gemini Premium), both calls metered — never Claude', async () => {
    process.env.GEMINI_API_KEY = 'AIza-platform';
    try {
      dispatchMock.mockImplementation(async (provider: any, input: any) => {
        if (input.maxTokens === 500) return { raw: '{}', model: input.model };
        return provider === 'openai' ? creditGone : { raw: board, model: input.model };
      });
      const { service, meter } = buildService(makeFakeRedisClient());
      const res = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' });
      expect(res.candidates).toHaveLength(3);
      const boards = dispatchMock.mock.calls.filter((c) => c[1].maxTokens === 16000);
      expect(boards.filter(([p]) => p === 'openai')).toHaveLength(3);
      const retried = boards.filter(([p]) => p === 'google');
      expect(retried).toHaveLength(3);
      expect(retried.every(([, i]) => i.apiKey === 'AIza-platform' && i.model === 'gemini-3.1-pro-preview')).toBe(true);
      expect(boards.filter(([p]) => p === 'anthropic')).toHaveLength(0);
      const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
      expect(audit).toMatchObject({ provider: 'google', model: 'gemini-3.1-pro-preview' });
      expect(meter.record.mock.calls.filter((c: any[]) => c[0].feature === 'designer')).toHaveLength(6);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('our OpenAI key out of credit with only an Anthropic key besides → AI_PLATFORM_UNAVAILABLE, and Claude never draws the board', async () => {
    dispatchMock.mockImplementation(async (_p: any, input: any) => (input.maxTokens === 500 ? { raw: '{}', model: input.model } : creditGone));
    const { service } = buildService(makeFakeRedisClient());
    const err = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' }).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'AI_PLATFORM_UNAVAILABLE' });
    expect(dispatchMock.mock.calls.filter(([p, i]) => p === 'anthropic' && i.maxTokens === 16000)).toHaveLength(0);
  });

  it('our key out of credit with NOWHERE to fail over → AI_PLATFORM_UNAVAILABLE (503), never "your OpenAI account has no credit"', async () => {
    delete process.env.ANTHROPIC_API_KEY; // only an OpenAI key: design has no second route
    dispatchMock.mockImplementation(async (_p: any, input: any) => (input.maxTokens === 500 ? { raw: '{}', model: input.model } : creditGone));
    const { service } = buildService(makeFakeRedisClient());
    const err = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' }).catch((e) => e);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'AI_PLATFORM_UNAVAILABLE' });
    expect(JSON.stringify(err.getResponse())).not.toMatch(/credit balance|platform\.openai\.com|ChatGPT/i);
  });

  it('a TENANT key never fails over to another vendor — their vendor, their choice', async () => {
    tenantsById.set('t1', { id: 't1', aiProvider: 'openai', aiKeyEncrypted: 'enc', aiModel: 'premium' });
    jest.spyOn(require('./ai-key-cipher'), 'openAiKey').mockReturnValue('sk-openai-tenant');
    dispatchMock.mockResolvedValue({ raw: '', errorStatus: 503, errorBody: 'overloaded' });
    const { service } = buildService(makeFakeRedisClient());
    await expect(service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' })).rejects.toBeTruthy();
    expect(dispatchMock.mock.calls.every(([p, i]) => p === 'openai' && i.apiKey === 'sk-openai-tenant')).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('a nearly-spent allowance cannot START a board batch it cannot afford (the estimate, not one credit per board)', async () => {
    // GPT-6 Sol: 3 × (12k in × $2/M + 10k out × $10/M) ≈ $0.37 → 37 credits; 20 credits left.
    const allowance = {
      snapshot: jest.fn(async () => ({
        orgTenantId: 't1', screens: 1, includedMicros: 5_000_000, usedMicros: 4_800_000,
        includedCredits: 500, usedCredits: 480, resetAt: '2026-10-01T00:00:00.000Z', perScreenUsd: 2, floorUsd: 5,
      })),
    };
    const { service } = buildService(makeFakeRedisClient(), undefined, undefined, undefined, allowance);
    await expect(service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AI_CAP_REACHED' }),
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  // ── the adversarial review of this routing (2026-09-22) ──
  const copy = JSON.stringify([{ text: 'Spring sale this weekend' }]);

  it('a vendor REFUSAL is never re-sent to another vendor — the operator is told it was declined (422 AI_DECLINED)', async () => {
    dispatchMock.mockImplementation(async (_p: any, input: any) =>
      input.maxTokens === 500
        ? { raw: '{}', model: input.model }
        : { raw: '', errorStatus: 502, refusal: true, errorBody: 'OpenAI declined this request (refusal).' },
    );
    const { service } = buildService(makeFakeRedisClient());
    const err = await service.generateDesignerBoardCandidates({ tenantId: 't1', prompt: 'coffee menu' }).catch((e) => e);
    expect(dispatchMock.mock.calls.filter(([p, i]) => p === 'anthropic' && i.maxTokens === 16000)).toHaveLength(0);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'AI_DECLINED' });
  });

  it('after a failover the AUDIT row names the vendor that actually answered, not the planned route', async () => {
    dispatchMock.mockImplementation(async (provider: any, input: any) =>
      provider === 'anthropic' ? { raw: '', errorStatus: 529, errorBody: 'overloaded' } : { raw: copy, model: input.model },
    );
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(dispatchMock.mock.calls.map(([p]) => p)).toEqual(['anthropic', 'openai']);
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_GENERATE').details);
    expect(audit).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', source: 'platform' });
  });

  it('Google rejecting OUR key with a 400 API_KEY_INVALID fails over like a 401 would', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-platform';
    require('./ai-model-catalog').setCatalogState({ platformRoutes: { fast: [{ provider: 'google', tier: 'standard' }] } });
    dispatchMock.mockImplementation(async (provider: any, input: any) =>
      provider === 'google'
        ? { raw: '', errorStatus: 400, errorBody: '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}' }
        : { raw: copy, model: input.model },
    );
    try {
      const { service } = buildService(makeFakeRedisClient());
      await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
      expect(dispatchMock.mock.calls.map(([p]) => p)).toEqual(['google', 'anthropic']);
      expect(dispatchMock.mock.calls[1][1].apiKey).toBe('sk-ant-platform');
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('…and with no other vendor to go to, a rejected Google key is OUR key problem: 503 AI_PLATFORM_UNAVAILABLE', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-platform';
    dispatchMock.mockResolvedValue({ raw: '', errorStatus: 400, errorBody: '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' });
    try {
      const { service } = buildService(makeFakeRedisClient());
      const err = await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' }).catch((e) => e);
      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toMatchObject({ code: 'AI_PLATFORM_UNAVAILABLE' });
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('a vendor that refuses the MODEL (404, after its own fallback) fails over to the next vendor', async () => {
    dispatchMock.mockImplementation(async (provider: any, input: any) =>
      provider === 'anthropic' ? { raw: '', errorStatus: 404, errorBody: '{"error":{"type":"not_found_error","message":"model: claude-haiku-4-5"}}' } : { raw: copy, model: input.model },
    );
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(dispatchMock.mock.calls.map(([p]) => p)).toEqual(['anthropic', 'openai']);
  });

  it('a TIMEOUT answer (408 / 504) never fails over — the time is already spent', async () => {
    for (const status of [408, 504]) {
      dispatchMock.mockReset();
      dispatchMock.mockResolvedValue({ raw: '', errorStatus: status, errorBody: 'timeout' });
      const { service } = buildService(makeFakeRedisClient());
      await expect(service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' })).rejects.toBeTruthy();
      expect(dispatchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('both attempts share ONE time budget: the failover gets only what is left, and none when too little is left', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    // the first vendor fails after 100 s → the failover is capped at the remaining 140 s of the 240 s budget
    dispatchMock.mockImplementation(async (provider: any, input: any) => {
      if (provider === 'anthropic') {
        now += 100_000;
        return { raw: '', errorStatus: 503, errorBody: 'overloaded' };
      }
      return { raw: copy, model: input.model };
    });
    const { service } = buildService(makeFakeRedisClient());
    await service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' });
    expect(dispatchMock.mock.calls[0][1].timeoutMs).toBeUndefined(); // attempt 0 keeps the model's own ceiling
    expect(dispatchMock.mock.calls[1][1].timeoutMs).toBe(140_000);

    // the first vendor fails after 230 s → 10 s left is not worth a second vendor; its error stands
    dispatchMock.mockReset();
    dispatchMock.mockImplementation(async () => {
      now += 230_000;
      return { raw: '', errorStatus: 503, errorBody: 'overloaded' };
    });
    await expect(service.generate({ tenantId: 't1', intent: 'announcement', context: 'sale' })).rejects.toBeTruthy();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});
