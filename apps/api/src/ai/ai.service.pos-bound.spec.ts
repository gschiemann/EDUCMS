/**
 * AiService — POS-bound AI boards (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one and ensures the template is
 * created with perfect integrations into those systems".
 *
 *   • the Concierge chat reads the venue's POS state SERVER-SIDE every turn and
 *     honours a client's selection only against this tenant's own connections;
 *
 * The Prisma double filters by the `where` it is handed, so a query that forgot
 * its tenant predicate would surface the other tenant's connection. The menu
 * double is shaped exactly like MenuService.resolvePosMenuForLocation's
 * ResolvedMenu. Only the provider dispatch is stubbed.
 */
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn(), dispatchAiMessages: jest.fn() };
});
import { dispatchAi, dispatchAiMessages } from './ai-providers';
import { AiService } from './ai.service';

const dispatchMock = dispatchAi as unknown as jest.Mock;
const messagesMock = dispatchAiMessages as unknown as jest.Mock;

const NOW = new Date();
const CONNECTIONS = [
  { id: 'conn-own-toast', tenantId: 't1', providerId: 'toast', displayName: null, status: 'ACTIVE', statusReason: null, lastSyncedAt: NOW, createdAt: NOW },
  { id: 'conn-foreign-square', tenantId: 't2', providerId: 'square', displayName: 'Beta Registers', status: 'ACTIVE', statusReason: null, lastSyncedAt: NOW, createdAt: NOW },
];

const menuItem = (externalId: string, name: string, priceCents: number, category: string, description: string | null = null) => ({
  id: `mi-${externalId}`, externalId, name, description, priceCents, priceOverridden: false, imageUrl: null,
  allergens: [], tags: [], category, categoryId: `cat-${category}`, sortOrder: 0, available: true, soldOut: false,
});

/** The venue's Toast menu, as MenuService resolves it for location t1. */
const TOAST_MENU = {
  locationTenantId: 't1',
  generatedAt: NOW.toISOString(),
  sourceConfigured: true,
  categories: [
    { id: 'cat-Tacos', name: 'Tacos', sortOrder: 0, daypartId: null },
    { id: 'cat-Burritos', name: 'Burritos', sortOrder: 1, daypartId: null },
  ],
  items: [
    menuItem('toast-birria', '3 Birria Tacos w/ consome', 1450, 'Tacos', 'slow-braised beef'),
    menuItem('toast-fish', 'Fish Taco', 450, 'Tacos'),
    menuItem('toast-asada', 'Asada Super Burrito', 1750, 'Burritos'),
  ],
};

const auditRows: any[] = [];

function buildService() {
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 't1' ? { id: 't1', parentId: null, aiProvider: null, aiKeyEncrypted: null, aiModel: null } : null)),
        update: jest.fn(async () => ({})),
      },
      tenantBranding: { findUnique: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
      posProviderConnection: {
        findMany: jest.fn(async ({ where }: any) => CONNECTIONS.filter((c) => where.tenantId.in.includes(c.tenantId))),
      },
    },
  };
  const menu = {
    resolveMenuForLocation: jest.fn(async () => ({ ...TOAST_MENU, items: [] })),
    resolvePosMenuForLocation: jest.fn(async (_loc: string, o?: any) =>
      o?.connectionId === 'conn-own-toast' || !o?.connectionId ? TOAST_MENU : { ...TOAST_MENU, sourceConfigured: false, categories: [], items: [] }),
  };
  const redis = { publisher: null } as any;
  const service = new AiService(prisma, redis, {} as any, { analyzeDesignReference: jest.fn() } as any, { isConfigured: () => false, search: async () => null } as any, menu as any);
  return { service, prisma, menu };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform';
  process.env.OPENAI_API_KEY = 'sk-openai-platform';
  auditRows.length = 0;
  dispatchMock.mockReset();
  messagesMock.mockReset();
  messagesMock.mockResolvedValue({ raw: JSON.stringify({ reply: 'Sounds great.', intake: { purpose: 'menu' }, missing: [], ready: false, brief: 'b' }) });
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

const systemPromptOf = () => (messagesMock.mock.calls[0][1] as any).system as string;

describe('AiService.conciergeChat — the venue\'s POS, read by the server every turn', () => {
  const chat = (over: any = {}) => ({ tenantId: 't1', messages: [{ role: 'user', content: 'a menu board for the counter' }], vertical: 'restaurant', ...over });

  it('a selection of the venue\'s OWN connection → the items are in hand and bound', async () => {
    const { service, menu } = buildService();
    await service.conciergeChat(chat({ posSelection: { connectionId: 'conn-own-toast', sections: ['Tacos'] } }));
    const system = systemPromptOf();
    expect(system).toContain("SELECTED FOR THIS BOARD: the venue's Toast menu");
    expect(system).toContain('2 items in 1 section: Tacos (2)');
    expect(system).toContain('IN HAND and will be BOUND to Toast');
    expect(menu.resolvePosMenuForLocation).toHaveBeenCalledWith('t1', { connectionId: 'conn-own-toast', includeUnavailable: true, ignoreDayparts: true });
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_CONCIERGE_CHAT').details);
    expect(audit.posState).toBe('selected');
  });

  it('a selection naming ANOTHER tenant\'s connection is ignored — and its name never reaches the model', async () => {
    const { service } = buildService();
    await service.conciergeChat(chat({ posSelection: { connectionId: 'conn-foreign-square', sections: ['Tacos'] } }));
    const system = systemPromptOf();
    expect(system).not.toContain('SELECTED FOR THIS BOARD:');
    expect(system).toContain('CONNECTED POS: Toast');
    expect(system).not.toContain('Beta Registers');
    expect(system).not.toContain('Square —');
  });

  it('nothing connected → on a menu board the model is told to ask which POS', async () => {
    const { service, prisma } = buildService();
    prisma.client.posProviderConnection.findMany.mockResolvedValue([]);
    await service.conciergeChat(chat());
    expect(systemPromptOf()).toContain('ask ONE question, once: which POS they use');
    expect(JSON.parse(auditRows.find((r) => r.action === 'AI_CONCIERGE_CHAT').details).posState).toBe('none');
  });

  it('a POS read failure never fails the chat — the model is told nothing is known and promises nothing', async () => {
    const { service, prisma } = buildService();
    prisma.client.posProviderConnection.findMany.mockRejectedValue(new Error('db blip'));
    const turn = await service.conciergeChat(chat());
    expect(turn.reply).toBe('Sounds great.');
    expect(systemPromptOf()).toContain('The POS status could not be read right now.');
  });
});
