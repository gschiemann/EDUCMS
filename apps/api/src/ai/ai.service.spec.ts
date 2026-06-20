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
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

// Mock ONLY dispatchAi; keep the rest of ai-providers real (the service
// imports mapProviderQuotaError + coerceProvider from the same module).
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
import { dispatchAi } from './ai-providers';
const dispatchMock = dispatchAi as unknown as jest.Mock;

// ── In-memory Prisma stub ───────────────────────────────────────────
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

function buildService(publisher: any): { service: AiService } {
  const redisMock = { publisher } as unknown as RedisService;
  // Synchronous construct — no Nest container needed, but use it for parity.
  const service = new AiService(prismaMock as PrismaService, redisMock);
  return { service };
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
    // Pre-fill the success window to the 30/hr cap.
    const now = Date.now();
    const win = new Map<string, number>();
    for (let i = 0; i < 30; i++) win.set(`m${i}`, now - 1000);
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
