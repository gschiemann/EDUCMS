import { Test, TestingModule } from '@nestjs/testing';
import { BugAnalyzerService } from './bug-analyzer.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

type Row = Record<string, any>;

/**
 * Minimal in-memory Prisma stand-in covering exactly what
 * BugAnalyzerService touches: bug.findUnique/update, auditLog.create,
 * auditLog.count, and (via the shared notifyBugFixProposed helper)
 * user.findUnique.
 */
function createInMemoryPrisma(seed: { bugs?: Row[]; users?: Row[] } = {}) {
  const bugs: Row[] = seed.bugs ?? [];
  const users: Row[] = seed.users ?? [];
  const auditLogs: Row[] = [];

  const client: any = {
    bug: {
      findUnique: async ({ where }: any) => bugs.find((b) => b.id === where.id) || null,
      update: async ({ where, data }: any) => {
        const row = bugs.find((b) => b.id === where.id);
        if (!row) throw new Error('Bug not found');
        Object.assign(row, data);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) || null,
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${auditLogs.length + 1}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
      count: async () => 0, // never over the daily cap in tests
    },
  };

  return { client, state: { bugs, users, auditLogs } };
}

/** A well-formed Anthropic tool-use response the analyzer expects. */
function fakeAnthropicResponse(overrides: Partial<Record<string, any>> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'report_bug_analysis',
          input: {
            rootCause: 'The widget never null-checks offsetWidth.',
            filesAffected: [
              { filePath: 'apps/web/src/components/widgets/Foo.tsx', reason: 'null check', diff: '+ if (!w) return;' },
            ],
            confidence: 82,
            testPlan: 'Open /player and confirm no crash.',
          },
          ...overrides,
        },
      ],
      usage: { input_tokens: 500, output_tokens: 200 },
    }),
    text: async () => '',
  };
}

describe('BugAnalyzerService', () => {
  let originalFetch: typeof fetch;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  async function buildService(seed: { bugs?: Row[]; users?: Row[] }, emailOverrides: Partial<EmailService> = {}) {
    const mem = createInMemoryPrisma(seed);
    const emailMock: Partial<EmailService> = {
      sendBugFiled: jest.fn().mockResolvedValue(undefined),
      sendBugFixShipped: jest.fn().mockResolvedValue(undefined),
      ...emailOverrides,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugAnalyzerService,
        { provide: PrismaService, useValue: { client: mem.client } },
        { provide: EmailService, useValue: emailMock },
      ],
    }).compile();

    const service = module.get(BugAnalyzerService);
    return { service, state: mem.state, emailMock: emailMock as jest.Mocked<EmailService> };
  }

  // 2026-09-22 — Greg: "make the bug tool use the new opus 5.5". The model is the catalog's newest
  // Claude Opus, and the request speaks Opus 5.5's rules: strict tool use with tool_choice auto
  // (forced tool use 400s), effort in output_config, no temperature, no `thinking` field.
  describe('runs on the newest Claude Opus (Opus 5.5), with its request rules', () => {
    it('sends claude-opus-5-5 with strict tool use + auto, medium effort, headroom for thinking; stores the real model + cost', async () => {
      const { service, state } = await buildService({
        bugs: [{ id: 'bug-1', tenantId: 'tenant-1', userId: null, status: 'NEW', description: 'x', capturedContext: {}, serverContext: null }],
      });
      const ok = fakeAnthropicResponse();
      const json = await ok.json();
      // Opus 5.5 replies START with a thinking block — the tool_use must still be found by type.
      json.content = [{ type: 'thinking', thinking: '' }, ...json.content];
      global.fetch = jest.fn().mockResolvedValue({ ...ok, json: async () => json }) as any;

      await service.analyze('bug-1');

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('claude-opus-5-5');
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.tools[0]).toMatchObject({ name: 'report_bug_analysis', strict: true });
      expect(body.tools[0].input_schema.additionalProperties).toBe(false);
      expect(body.tools[0].input_schema.properties.filesAffected.items.additionalProperties).toBe(false);
      expect(JSON.stringify(body.tools[0].input_schema)).not.toMatch(/"minimum"|"maximum"/);
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body.temperature).toBeUndefined();
      expect(body.thinking).toBeUndefined();
      expect(body.max_tokens).toBe(4000 + 24000); // medium effort → medium headroom
      expect(state.bugs[0].status).toBe('PROPOSED');
      expect(state.bugs[0].aiModel).toBe('claude-opus-5-5');
      // 500 in × $4/M + 200 out × $20/M = $0.006
      expect(state.bugs[0].aiCostUsd).toBeCloseTo(0.006, 6);
    });
  });

  // 2026-10-11: a proposed fix is an INTERNAL review step. The customer who
  // reported the bug is never emailed root cause / confidence / diff links.
  describe('fix-proposed is not customer mail', () => {
    it('flips the bug to PROPOSED without emailing the reporter anything', async () => {
      const { service, state, emailMock } = await buildService({
        bugs: [
          {
            id: 'bug-1',
            tenantId: 'tenant-1',
            userId: 'reporter-1',
            status: 'NEW',
            description: 'crashes on load',
            capturedContext: {},
            serverContext: null,
          },
        ],
        users: [{ id: 'reporter-1', email: 'reporter@acme.edu' }],
      });

      global.fetch = jest.fn().mockResolvedValue(fakeAnthropicResponse()) as any;

      await service.analyze('bug-1');
      expect(state.bugs[0].status).toBe('PROPOSED');

      await new Promise((r) => setImmediate(r));
      expect(emailMock.sendBugFiled).not.toHaveBeenCalled();
      expect(emailMock.sendBugFixShipped).not.toHaveBeenCalled();
    });
  });
});
