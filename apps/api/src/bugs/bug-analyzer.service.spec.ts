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
      sendBugFixProposed: jest.fn().mockResolvedValue(undefined),
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

  // email-fix #4 (2026-07-03): the automatic AI-analysis path previously
  // flipped Bug.status -> 'PROPOSED' but never notified the reporter —
  // only the manual chat-writeback controller endpoint did. These tests
  // prove the analyzer now fires the same "fix proposed" notification,
  // and that a notify failure can never break the analysis result.
  describe('fix-proposed notification (email-fix #4)', () => {
    it('emits sendBugFixProposed to the reporter after a successful PROPOSED persist', async () => {
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

      // Status actually flipped to PROPOSED.
      expect(state.bugs[0].status).toBe('PROPOSED');

      // Fire-and-forget notify is a microtask chain (prisma.user.findUnique
      // .then(...)) — flush the microtask queue before asserting.
      await new Promise((r) => setImmediate(r));

      expect(emailMock.sendBugFixProposed).toHaveBeenCalledTimes(1);
      expect(emailMock.sendBugFixProposed).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'reporter@acme.edu',
          bugId: 'bug-1',
          confidence: 82,
          filesAffectedCount: 1,
        }),
      );
    });

    it('does not throw and does not break the PROPOSED status when the notify email fails', async () => {
      const { service, state, emailMock } = await buildService(
        {
          bugs: [
            {
              id: 'bug-2',
              tenantId: 'tenant-1',
              userId: 'reporter-2',
              status: 'NEW',
              description: 'crashes on load',
              capturedContext: {},
              serverContext: null,
            },
          ],
          users: [{ id: 'reporter-2', email: 'reporter2@acme.edu' }],
        },
        { sendBugFixProposed: jest.fn().mockRejectedValue(new Error('Resend 500')) },
      );

      global.fetch = jest.fn().mockResolvedValue(fakeAnthropicResponse()) as any;

      await expect(service.analyze('bug-2')).resolves.toBeUndefined();

      // The PROPOSED persist already landed BEFORE the notify fires —
      // a failed notify must never roll it back or throw out of analyze().
      expect(state.bugs[0].status).toBe('PROPOSED');

      await new Promise((r) => setImmediate(r));
      expect(emailMock.sendBugFixProposed).toHaveBeenCalledTimes(1);
    });

    it('skips the notify entirely when the bug has no reporter (userId null)', async () => {
      const { service, state, emailMock } = await buildService({
        bugs: [
          {
            id: 'bug-3',
            tenantId: 'tenant-1',
            userId: null,
            status: 'NEW',
            description: 'anonymous report',
            capturedContext: {},
            serverContext: null,
          },
        ],
        users: [],
      });

      global.fetch = jest.fn().mockResolvedValue(fakeAnthropicResponse()) as any;

      await service.analyze('bug-3');
      expect(state.bugs[0].status).toBe('PROPOSED');

      await new Promise((r) => setImmediate(r));
      expect(emailMock.sendBugFixProposed).not.toHaveBeenCalled();
    });

    it('does not notify when the Anthropic call fails (status reverts, never reaches PROPOSED)', async () => {
      const { service, state, emailMock } = await buildService({
        bugs: [
          {
            id: 'bug-4',
            tenantId: 'tenant-1',
            userId: 'reporter-4',
            status: 'NEW',
            description: 'crashes on load',
            capturedContext: {},
            serverContext: null,
          },
        ],
        users: [{ id: 'reporter-4', email: 'reporter4@acme.edu' }],
      });

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as any;

      await service.analyze('bug-4');
      expect(state.bugs[0].status).toBe('NEW'); // reverted, not PROPOSED

      await new Promise((r) => setImmediate(r));
      expect(emailMock.sendBugFixProposed).not.toHaveBeenCalled();
    });
  });
});
