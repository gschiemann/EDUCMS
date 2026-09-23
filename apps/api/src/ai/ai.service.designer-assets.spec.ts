/**
 * AiService.generateDesignerBoardCandidates — the images a board is drawn
 * around (2026-09-23, the Codex-parity wave, "assets task 2").
 *
 *   • PROVENANCE: the generate request says whose logo / photo it is
 *     (`logoSource` / `heroImageSource`, from the Concierge reference that won),
 *     and every draw's user prompt says it plainly — a stock photo is never
 *     called the venue's own.
 *
 * Only the provider dispatch is stubbed (`dispatchAi`); the prompt builder, the
 * sanitizer, the binder and the fact guard are the real ones.
 */
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
import { dispatchAi } from './ai-providers';
import { AiService } from './ai.service';

const dispatchMock = dispatchAi as unknown as jest.Mock;

const LOGO = 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/uploads/0123456789abcdef.png';
const PHOTO = 'https://sb.example/storage/v1/object/public/assets/ai-stock/t1/fedcba9876543210.jpg';

/** A small, complete board that uses the logo and the photo it was given. */
const WELCOME_BOARD =
  '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:relative;background:#fffaf2}' +
  'h1{font-size:120px}.hero{width:900px;height:600px}</style></head><body><div class="stage">' +
  `<img data-imgslot="logo" src="${LOGO}" alt="Super Taco">` +
  '<h1 data-field="headline" data-fit data-fit-min="26">Welcome to Super Taco</h1>' +
  `<div class="hero"><img data-imgslot="hero" src="${PHOTO}" alt=""></div>` +
  '</div></body></html>';

function buildService() {
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 't1' ? { id: 't1', parentId: null, aiProvider: null, aiKeyEncrypted: null, aiModel: null } : null,
        ),
        update: jest.fn(async () => ({})),
      },
      tenantBranding: { findUnique: jest.fn(async () => null) },
      template: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async ({ data }: any) => data), findMany: jest.fn(async () => []) },
      posProviderConnection: { findMany: jest.fn(async () => []) },
    },
  };
  const menu: any = {
    resolveMenuForLocation: jest.fn(async () => ({ items: [], categories: [] })),
    resolvePosMenuForLocation: jest.fn(async () => ({ items: [], categories: [] })),
  };
  const stock: any = { isConfigured: () => false, search: async () => null };
  const service = new AiService(prisma, { publisher: null } as any, {} as any, { analyzeDesignReference: jest.fn() } as any, stock, menu);
  return { service, prisma, menu };
}

/** The board draws' user prompts (the brief read is the 500-token call). */
const drawPrompts = () => dispatchMock.mock.calls.filter((c) => c[1].maxTokens !== 500).map((c) => String(c[1].userPrompt));
const lineOf = (p: string, label: 'Logo' | 'Photo') => p.split('\n').find((l) => l.startsWith(`${label}: `)) || '';

const saved = { ...process.env };
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-openai-platform';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.RENDERER_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.AI_DESIGNER_DISABLED;
  dispatchMock.mockReset();
  dispatchMock.mockImplementation(async (_p: any, input: any) =>
    input.maxTokens === 500 ? { raw: '{}' } : { raw: WELCOME_BOARD, model: 'gpt-6-sol' },
  );
});
afterAll(() => {
  process.env = saved;
});

const welcome = (over: Record<string, unknown> = {}) => ({
  tenantId: 't1',
  prompt: 'a welcome board for the lobby',
  vertical: 'restaurant',
  venueName: 'Super Taco',
  purpose: 'welcome',
  logoUrl: LOGO,
  heroImageUrl: PHOTO,
  ...over,
});

describe('provenance reaches every draw', () => {
  it('an uploaded logo and a STOCK photo: the prompt says whose each one is', async () => {
    const { service } = buildService();
    const out = await service.generateDesignerBoardCandidates(welcome({ logoSource: 'upload', heroImageSource: 'stock' }) as any);
    expect(out.candidates).toHaveLength(3);
    const prompts = drawPrompts();
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(lineOf(p, 'Logo')).toContain(`Logo: ${LOGO} — the venue's own logo, uploaded by the operator — put it in the header`);
      expect(lineOf(p, 'Photo')).toContain(`Photo: ${PHOTO} — a stock photo, not the venue's own — never caption it as theirs`);
      expect(lineOf(p, 'Photo')).not.toContain("the venue's own photo");
    }
  });

  it('a site logo and a POS photo', async () => {
    const { service } = buildService();
    await service.generateDesignerBoardCandidates(welcome({ logoSource: 'site', heroImageSource: 'pos' }) as any);
    for (const p of drawPrompts()) {
      expect(lineOf(p, 'Logo')).toContain("the venue's own logo, from their website");
      expect(lineOf(p, 'Photo')).toContain("the venue's own photo of one of their menu items, from their point-of-sale system");
    }
  });

  it('negative control: with no provenance the lines claim nothing either way (the pre-2026-09-23 prompt)', async () => {
    const { service } = buildService();
    await service.generateDesignerBoardCandidates(welcome() as any);
    for (const p of drawPrompts()) {
      expect(lineOf(p, 'Logo')).toBe(
        `Logo: ${LOGO} — put it in the header as <img data-imgslot="logo" src="${LOGO}" alt="Super Taco"> sized to its slot with object-fit:contain, and typeset the venue name as its fallback.`,
      );
      expect(lineOf(p, 'Photo')).toBe(
        `Photo: ${PHOTO} — use it in the layout's framed photo panel or slot as <img data-imgslot="hero" src="${PHOTO}" alt=""> with object-fit:cover. Not as a wash behind running text.`,
      );
    }
  });
});
