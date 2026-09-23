/**
 * GOLDEN — the AI Designer's returned candidates, byte for byte (2026-09-23).
 *
 * The render → critique → revise loop, the static-defect redraw, the image parts
 * and the prompt-cache reorder all land inside `generateDesignerBoardCandidates`.
 * With the renderer NOT configured (`RENDERER_URL` unset) and a draft that is not
 * truncated, none of that may change what the operator gets back. This spec pins
 * it: the candidates in __fixtures__/designer-candidates.golden.json were
 * RECORDED by running this exact spec against 9dec4f5c (the base the review loop
 * was built on, EDUCMS-SHIM-V7), before any of it existed —
 *
 *   RECORD_DESIGNER_GOLDEN=1 pnpm --filter api exec jest designer-candidates.golden
 *
 * — and every later run must reproduce them exactly. Never re-record to make a
 * red run green: a diff here IS the regression.
 *
 * The draws are the provider's own output shape (DispatchOutput) around a real
 * GPT-6 Sol board: __fixtures__/super-taco-burritos.board.html, cut from the
 * Super Taco wall Codex built with GPT-6 Sol (see its provenance header).
 * `dispatchAi` is the only thing mocked.
 */
import fs from 'node:fs';
import path from 'node:path';

jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
import { dispatchAi } from './ai-providers';
import { AiService } from './ai.service';

const dispatchMock = dispatchAi as unknown as jest.Mock;
const GOLDEN = path.join(__dirname, '__fixtures__', 'designer-candidates.golden.json');
const BOARD = fs.readFileSync(path.join(__dirname, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8');

/** The brief-extraction reply, as the fast model writes it (parseDesignerBrief's contract). */
const BRIEF_REPLY = JSON.stringify({
  occasion: 'burritos menu wall',
  headline: 'Burritos & More',
  items: [],
  dateTime: '',
  tone: 'bold',
  callToAction: '',
});

function buildService() {
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 't1'
            ? { id: 't1', name: 'Golden Tenant', parentId: null, aiProvider: null, aiKeyEncrypted: null, aiModel: null, address: null }
            : null,
        ),
        update: jest.fn(async () => ({})),
      },
      tenantBranding: { findUnique: jest.fn(async () => null) },
      template: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async ({ data }: any) => data), findMany: jest.fn(async () => []) },
    },
  };
  const redis: any = { publisher: null };
  const menu: any = {
    resolveMenuForLocation: jest.fn(async () => ({ items: [] })),
    resolvePosMenuForLocation: jest.fn(async () => ({ items: [] })),
  };
  const stock: any = { isConfigured: () => false, search: async () => null };
  return new AiService(prisma, redis, {} as any, { analyzeDesignReference: jest.fn() } as any, stock, menu);
}

/** Each board call answers with the provider's DispatchOutput shape. Candidate 2's draft comes wrapped in a fence. */
function scriptDraws() {
  let board = 0;
  dispatchMock.mockImplementation(async (_provider: any, input: any) => {
    if (input.maxTokens === 500) {
      return { raw: BRIEF_REPLY, model: 'gpt-6-luna', usage: { inputTokens: 900, outputTokens: 60 }, durationMs: 800 };
    }
    board += 1;
    const raw = board === 2 ? `Here is your board:\n\`\`\`html\n${BOARD}\n\`\`\`` : BOARD;
    return { raw, model: 'gpt-6-sol', usage: { inputTokens: 14_000, outputTokens: 9_000 }, durationMs: 61_000 };
  });
}

const SCENARIOS: Array<{ name: string; opts: any }> = [
  {
    name: 'menu, 4K landscape, prices partly grounded, untrusted logo + photo URLs',
    opts: {
      tenantId: 't1',
      prompt: 'a menu board for our burritos wall',
      screenWidth: 3840,
      screenHeight: 2160,
      vertical: 'restaurant',
      venueName: 'Super Taco',
      palette: ['#d83c21', '#f1c93a', '#2d1a13', '#fffaf2'],
      logoUrl: 'https://www.supertacomex.com/logo.png',
      heroImageUrl: 'https://static.wixstatic.com/media/burrito.jpg',
      purpose: 'menu',
      content: [
        'Burritos — Asada Super Burrito — $17.50',
        'Burritos — Grilled Chicken Super Burrito — $15.50',
        'Nachos — Shredded Chicken Super Nachos — $19.00',
        'Quesadillas — Steak Quesadilla — $7.75',
      ].join('\n'),
    },
  },
  {
    name: 'welcome, portrait, no content (every price is ungrounded)',
    opts: {
      tenantId: 't1',
      prompt: 'a welcome board for the lobby',
      screenWidth: 2160,
      screenHeight: 3840,
      vertical: 'restaurant',
      venueName: 'Super Taco',
    },
  },
];

describe('AI Designer — candidates are byte-identical with the renderer off (golden)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-platform';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.RENDERER_URL;
    delete process.env.AI_DESIGN_REVIEW_DISABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.AI_DESIGNER_DISABLED;
    dispatchMock.mockReset();
  });
  afterAll(() => {
    process.env = saved;
  });

  it('reproduces the recorded candidates for every scenario', async () => {
    const got: Record<string, unknown> = {};
    for (const s of SCENARIOS) {
      scriptDraws();
      const out = await buildService().generateDesignerBoardCandidates(s.opts);
      got[s.name] = out.candidates;
    }
    const serialized = JSON.stringify(got, null, 2) + '\n';
    if (process.env.RECORD_DESIGNER_GOLDEN === '1') fs.writeFileSync(GOLDEN, serialized);
    // Byte for byte, not just deep-equal.
    expect(serialized).toBe(fs.readFileSync(GOLDEN, 'utf8'));
  });
});
