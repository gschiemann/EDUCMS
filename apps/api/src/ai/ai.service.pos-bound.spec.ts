/**
 * AiService — POS-bound AI boards (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one and ensures the template is
 * created with perfect integrations into those systems".
 *
 *   • the Concierge chat reads the venue's POS state SERVER-SIDE every turn and
 *     honours a client's selection only against this tenant's own connections;
 *   • a posSelection makes the SERVER build the board's item list (client
 *     content and brief items ignored, auto-grounding skipped), the model sees
 *     only `[item.N]` numbers — never an id — and every board comes back bound,
 *     retried once, dropped, or the whole batch answers 422
 *     MENU_BINDING_INCOMPLETE;
 *   • "Edit with words" re-stamps the same bindings on the revised board.
 *
 * The fake model boards follow the row contract the prompt asks for
 * (data-menu-row="N" + item.N.name/price/desc), the way the Super Taco boards
 * GPT-6 Sol wrote for Codex key their cards.
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
import { HttpException } from '@nestjs/common';
import { dispatchAi, dispatchAiMessages } from './ai-providers';
import { AiService } from './ai.service';
import { designerStructuresFor } from './designer-structures';
import { readMenuBindings } from './menu-binding';

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

/** The hourly-window writes (zadd) a batch records — the honest-accounting check. */
function makeFakeRedis() {
  const adds: string[] = [];
  return {
    adds,
    publisher: {
      zremrangebyscore: jest.fn(async () => 0),
      zcard: jest.fn(async () => 0),
      zadd: jest.fn(async (key: string) => { adds.push(key); return 1; }),
      pexpire: jest.fn(async () => 1),
    },
  };
}

function buildService(redis: any = { publisher: null }) {
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

// ── Generation ─────────────────────────────────────────────────────────────

type Row = { n: number; name: string; price: string; desc?: string; attrs?: string };

/** A board as the model writes it under the row contract. */
function boardFor(rows: Row[], extra = ''): string {
  return (
    '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:absolute;top:0;left:0}</style></head>' +
    '<body><div class="stage"><h1 data-field="headline">Tacos &amp; More</h1><div class="menu" data-fit-col>' +
    rows
      .map(
        (r) =>
          `<div class="row" data-menu-row="${r.n}"${r.attrs || ''}><span class="nm" data-field="item.${r.n}.name">${r.name}</span>` +
          (r.desc ? `<span class="ds" data-field="item.${r.n}.desc">${r.desc}</span>` : '') +
          `<span class="pr" data-field="item.${r.n}.price">${r.price}</span></div>`,
      )
      .join('') +
    `</div>${extra}</div></body></html>`
  );
}

/** The model's faithful board for the Tacos + Burritos plan (it "tidied" one name). */
const GOOD_ROWS: Row[] = [
  { n: 0, name: 'Birria Tacos', price: '$14.50', desc: 'slow-braised beef' },
  { n: 1, name: 'Fish Taco', price: '$4.50' },
  { n: 2, name: 'Asada Super Burrito', price: '$17.50' },
];
const MISSING_ROW_2 = GOOD_ROWS.slice(0, 2);

/** Answer each call by the LAYOUT it carries: layout i → the i-th script, one entry per attempt. */
function scriptedDesigner(scripts: string[][]) {
  const attempts = scripts.map(() => 0);
  dispatchMock.mockImplementation(async (_provider: any, input: any) => {
    if (input.maxTokens === 500) return { raw: '{}' }; // the brief read — no signal
    // Each candidate is one LAYOUT of the menu purpose (they replaced the art directions).
    const i = designerStructuresFor('menu').findIndex((st) => input.userPrompt.includes(`LAYOUT FOR THIS OPTION — ${st.label.toUpperCase()}:`));
    const script = scripts[i];
    const raw = script[Math.min(attempts[i], script.length - 1)];
    attempts[i] += 1;
    return { raw, model: 'gpt-6-sol' };
  });
  return attempts;
}

const generate = (service: AiService, over: any = {}) =>
  service.generateDesignerBoardCandidates({
    tenantId: 't1',
    prompt: 'a menu board for the counter',
    vertical: 'restaurant',
    posSelection: { connectionId: 'conn-own-toast', sections: ['Tacos', 'Burritos'] },
    ...over,
  });

const userPrompts = () => dispatchMock.mock.calls.filter((c) => c[1].maxTokens !== 500).map((c) => c[1].userPrompt as string);

describe('AiService.generateDesignerBoardCandidates — a POS-bound board', () => {
  it('the SERVER builds the item list: [item.N] rows from this tenant\'s catalog, never the client\'s content', async () => {
    const { service, menu } = buildService();
    scriptedDesigner([[boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    await generate(service, { content: 'Burger — $2.99\nFries — $3.00\nShake — $5.00' });
    for (const p of userPrompts()) {
      expect(p).toContain('LIVE POS MENU from Toast. 3 items in 2 sections, bound to the venue\'s POS.');
      expect(p).toContain('[item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef');
      expect(p).toContain('[item.2] Burritos — Asada Super Burrito — $17.50');
      expect(p).not.toContain('Burger');
      // Auto-grounding never ran: its "live POS menu" block is not there.
      expect(p).not.toContain("Real menu items from this venue's live POS menu");
    }
    // Every menu read was the design-time read of THIS connection — never the auto-ground read.
    for (const call of menu.resolvePosMenuForLocation.mock.calls) {
      expect(call).toEqual(['t1', { connectionId: 'conn-own-toast', includeUnavailable: true, ignoreDayparts: true }]);
    }
  });

  it('the model never receives an id — not in the system prompt, not in the user prompt', async () => {
    const { service } = buildService();
    scriptedDesigner([[boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    await generate(service);
    for (const [, input] of dispatchMock.mock.calls) {
      const everything = `${input.system}\n${input.userPrompt}`;
      expect(everything).not.toMatch(/toast-(birria|fish|asada)/);
      expect(everything).not.toContain('conn-own-toast');
    }
  });

  it('items in a client brief are ignored too — the plan is the only menu', async () => {
    const { service } = buildService();
    scriptedDesigner([[boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    await generate(service, {
      brief: { occasion: 'lunch menu', headline: 'Taco Tuesday', items: ['House Margarita — $6'], dateTime: '', tone: 'bold', callToAction: '' },
    });
    for (const p of userPrompts()) {
      expect(p).toContain('Taco Tuesday');
      expect(p).not.toContain('House Margarita');
    }
  });

  it('every board comes back bound: catalog ids on the rows, catalog names on the glass, boundTo in the answer', async () => {
    const { service } = buildService();
    scriptedDesigner([
      [boardFor(GOOD_ROWS.map((r) => (r.n === 1 ? { ...r, attrs: ' data-pos-item="t2-secret-guid"' } : r)))],
      [boardFor(GOOD_ROWS)],
      [boardFor(GOOD_ROWS)],
    ]);
    const res = await generate(service);
    expect(res.candidates).toHaveLength(3);
    expect(res.boundTo).toEqual({ providerId: 'toast', providerName: 'Toast', itemCount: 3 });
    for (const c of res.candidates) {
      expect(readMenuBindings(c.html)).toEqual({
        connectionId: 'conn-own-toast',
        providerId: 'toast',
        slots: { 'item.0': 'toast-birria', 'item.1': 'toast-fish', 'item.2': 'toast-asada' },
      });
      expect(c.html).toContain('data-field="item.0.name">3 Birria Tacos w/ consome<');
      expect(c.html).not.toContain('t2-secret-guid'); // the model's own id never survives
    }
  });

  it('a board that loses a planned row is retried ONCE — and both draws are accounted for', async () => {
    const redis = makeFakeRedis();
    const { service } = buildService(redis);
    const attempts = scriptedDesigner([[boardFor(MISSING_ROW_2), boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    const res = await generate(service);
    expect(res.candidates).toHaveLength(3);
    expect(attempts).toEqual([2, 1, 1]);
    // The retry is told which row went missing — by number, never by id.
    const retryPrompt = userPrompts().find((p) => p.includes('the previous attempt left out'))!;
    expect(retryPrompt).toContain('the previous attempt left out [item.2]. Render EVERY [item.N] row exactly once');
    expect(retryPrompt).not.toContain('toast-asada');
    expect(redis.adds.filter((k) => k === 'ai:rl:gen:t1')).toHaveLength(4); // 3 boards + the retry
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(audit.pos).toEqual({ providerId: 'toast', items: 3, bindingRetries: 1, boardsDropped: 0 });
  });

  it('a board that loses a row twice is dropped; the others still ship', async () => {
    const { service } = buildService();
    scriptedDesigner([[boardFor(MISSING_ROW_2)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    const res = await generate(service);
    expect(res.candidates).toHaveLength(2);
    const audit = JSON.parse(auditRows.find((r) => r.action === 'AI_DESIGNER_CANDIDATES').details);
    expect(audit.pos.boardsDropped).toBe(1);
  });

  it('when every board fails: 422 MENU_BINDING_INCOMPLETE — "N items don\'t fit one screen"', async () => {
    const { service } = buildService();
    scriptedDesigner([[boardFor(MISSING_ROW_2)], [boardFor(MISSING_ROW_2)], [boardFor(MISSING_ROW_2)]]);
    let err: any;
    try { await generate(service); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({
      code: 'MENU_BINDING_INCOMPLETE',
      message: "3 items don't fit one screen — choose fewer sections.",
    });
    expect(dispatchMock.mock.calls.filter((c) => c[1].maxTokens !== 500)).toHaveLength(6); // 3 boards × 2 tries
  });

  it('an invented price on a bound row is caught by the guard, and the retry fixes the board', async () => {
    const { service } = buildService();
    // The model put a "$2 extra guac" upsell in row 1's description → that row is
    // dropped by the price guard → the board no longer shows every item → retry.
    const upsell = GOOD_ROWS.map((r) => (r.n === 1 ? { ...r, desc: 'add guac $2' } : r));
    const attempts = scriptedDesigner([[boardFor(upsell), boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    const res = await generate(service);
    expect(attempts[0]).toBe(2);
    for (const c of res.candidates) expect(c.html).not.toContain('$2<');
  });

  it('another tenant\'s connection id is a 422 before anything is spent', async () => {
    const { service } = buildService();
    let err: any;
    try { await generate(service, { posSelection: { connectionId: 'conn-foreign-square', sections: ['Tacos'] } }); } catch (e) { err = e; }
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse().code).toBe('POS_CONNECTION_NOT_FOUND');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('more items than one screen shows is a 422 before anything is spent (the server counts, not the card)', async () => {
    const { service, menu } = buildService();
    const many = Array.from({ length: 13 }, (_, i) => menuItem(`toast-t${i}`, `Taco ${i}`, 400 + i, 'Tacos'));
    menu.resolvePosMenuForLocation.mockResolvedValue({ ...TOAST_MENU, items: many });
    let err: any;
    try { await generate(service, { screenWidth: 1280, screenHeight: 720, posSelection: { connectionId: 'conn-own-toast', sections: ['Tacos'] } }); } catch (e) { err = e; }
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'MENU_TOO_MANY_ITEMS', count: 13, rowLimit: 12 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('without a posSelection nothing changes: no binding, no boundTo', async () => {
    const { service } = buildService();
    scriptedDesigner([[boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    const res = await generate(service, { posSelection: undefined, content: 'Birria Tacos $14.50\nFish Taco $4.50\nAsada Super Burrito $17.50' });
    expect(res.boundTo).toBeUndefined();
    for (const c of res.candidates) expect(c.html).not.toContain('data-pos-item');
  });
});

// ── "Edit with words" ──────────────────────────────────────────────────────

describe('AiService.refineDesignerBoard — a bound board stays bound', () => {
  it('re-stamps the catalog ids, restores the catalog price, and leaves a row the operator ADDED unbound', async () => {
    const { service } = buildService();
    // Start from a board generation produced (bound).
    scriptedDesigner([[boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)], [boardFor(GOOD_ROWS)]]);
    const bound = (await generate(service)).candidates[0].html;
    dispatchMock.mockReset();
    // The revision dropped every binding attribute, "adjusted" a price, and added
    // the row the operator asked for.
    const revised = boardFor([
      { n: 0, name: '3 Birria Tacos w/ consome', price: '$15.00' },
      { n: 1, name: 'Fish Taco', price: '$4.50' },
      { n: 2, name: 'Asada Super Burrito', price: '$17.50' },
      { n: 3, name: 'Horchata', price: '$3.25' },
    ]).replace(/ data-menu-row="\d"/g, '');
    dispatchMock.mockResolvedValue({ raw: revised, model: 'gpt-6-sol' });
    const out = await service.refineDesignerBoard({ tenantId: 't1', html: bound, instruction: 'add horchata for $3.25' });
    expect(readMenuBindings(out.html).slots).toEqual({ 'item.0': 'toast-birria', 'item.1': 'toast-fish', 'item.2': 'toast-asada' });
    expect(out.html).toContain('data-field="item.0.price">$14.50<');
    expect(out.html).not.toContain('$15.00');
    expect(out.html).toContain('Horchata'); // the operator's own row, unbound
  });
});
