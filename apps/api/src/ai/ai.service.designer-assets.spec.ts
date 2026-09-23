/**
 * AiService.generateDesignerBoardCandidates — the images a board is drawn
 * around (2026-09-23, the Codex-parity wave, "assets task 2").
 *
 *   • PROVENANCE: the generate request says whose logo / photo it is
 *     (`logoSource` / `heroImageSource`, from the Concierge reference that won),
 *     and every draw's user prompt says it plainly — a stock photo is never
 *     called the venue's own.
 *   • POS ITEM PHOTOS: a POS-bound board's rows carry the POS's own photo of
 *     each dish, re-hosted into AiService's OWN bucket (`this.storage`) before
 *     the draw; every returned board shows each row its own photo or none.
 *   • NON-POS MENUS get no per-item photos at all (a wrong dish is worse than
 *     none): nothing fetched, nothing stored, no photo instruction.
 *
 * Only the provider dispatch (`dispatchAi`) and the network (`safeFetch`, routed
 * to an offline Toast CDN of real JPEG encodings) are stubbed; the menu is the
 * producer chain in test/toast-photo-menu.ts; the prompt builder, sanitizer,
 * binder and fact guard are the real ones.
 */
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
const safeFetchMock = jest.fn();
jest.mock('../branding/safe-fetch', () => ({
  ...jest.requireActual<object>('../branding/safe-fetch'),
  safeFetch: (...args: unknown[]): unknown => safeFetchMock(...args),
}));
import { dispatchAi } from './ai-providers';
import { AiService } from './ai.service';
import { parsePosBoundRows } from './designer-prompt';
import { readMenuBindings } from './menu-binding';
import {
  memoryBucket,
  toastPhotoCatalog,
  toastPhotoCdn,
  TOAST_CONNECTION_ID,
  TOAST_PHOTO_URLS,
} from '../../test/toast-photo-menu';

jest.setTimeout(30_000);

const dispatchMock = dispatchAi as unknown as jest.Mock;

const LOGO =
  'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/uploads/0123456789abcdef.png';
const PHOTO =
  'https://sb.example/storage/v1/object/public/assets/ai-stock/t1/fedcba9876543210.jpg';

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
          where.id === 't1'
            ? {
                id: 't1',
                parentId: null,
                aiProvider: null,
                aiKeyEncrypted: null,
                aiModel: null,
              }
            : null,
        ),
        update: jest.fn(async () => ({})),
      },
      tenantBranding: { findUnique: jest.fn(async () => null) },
      template: { findMany: jest.fn(async () => []) },
      auditLog: {
        create: jest.fn(async ({ data }: any) => data),
        findMany: jest.fn(async () => []),
      },
      posProviderConnection: { findMany: jest.fn(async () => []) },
    },
  };
  const menu: any = {
    resolveMenuForLocation: jest.fn(async () => ({
      items: [],
      categories: [],
    })),
    resolvePosMenuForLocation: jest.fn(async () => ({
      items: [],
      categories: [],
    })),
  };
  const stock: any = { isConfigured: () => false, search: async () => null };
  const service = new AiService(
    prisma,
    { publisher: null } as any,
    {} as any,
    { analyzeDesignReference: jest.fn() } as any,
    stock,
    menu,
  );
  return { service, prisma, menu };
}

/** The board draws' user prompts (the brief read is the 500-token call). */
const drawPrompts = () =>
  dispatchMock.mock.calls
    .filter((c) => c[1].maxTokens !== 500)
    .map((c) => String(c[1].userPrompt));
const lineOf = (p: string, label: 'Logo' | 'Photo') =>
  p.split('\n').find((l) => l.startsWith(`${label}: `)) || '';

const saved = { ...process.env };
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-openai-platform';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.RENDERER_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.AI_DESIGNER_DISABLED;
  safeFetchMock.mockReset();
  safeFetchMock.mockImplementation(() =>
    Promise.reject(new Error('no network in this spec')),
  );
  dispatchMock.mockReset();
  dispatchMock.mockImplementation(async (_p: any, input: any) =>
    input.maxTokens === 500
      ? { raw: '{}' }
      : { raw: WELCOME_BOARD, model: 'gpt-6-sol' },
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
    const out = await service.generateDesignerBoardCandidates(
      welcome({ logoSource: 'upload', heroImageSource: 'stock' }) as any,
    );
    expect(out.candidates).toHaveLength(3);
    const prompts = drawPrompts();
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(lineOf(p, 'Logo')).toContain(
        `Logo: ${LOGO} — the venue's own logo, uploaded by the operator — put it in the header`,
      );
      expect(lineOf(p, 'Photo')).toContain(
        `Photo: ${PHOTO} — a stock photo, not the venue's own — never caption it as theirs`,
      );
      expect(lineOf(p, 'Photo')).not.toContain("the venue's own photo");
    }
  });

  it('a site logo and a POS photo', async () => {
    const { service } = buildService();
    await service.generateDesignerBoardCandidates(
      welcome({ logoSource: 'site', heroImageSource: 'pos' }) as any,
    );
    for (const p of drawPrompts()) {
      expect(lineOf(p, 'Logo')).toContain(
        "the venue's own logo, from their website",
      );
      expect(lineOf(p, 'Photo')).toContain(
        "the venue's own photo of one of their menu items, from their point-of-sale system",
      );
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

// ── POS item photos, through the real AiService ────────────────────────────

const NOW = new Date('2026-09-23T12:00:00.000Z');
const CONNECTIONS = [
  {
    id: TOAST_CONNECTION_ID,
    tenantId: 't1',
    providerId: 'toast',
    displayName: null,
    status: 'ACTIVE',
    statusReason: null,
    lastSyncedAt: NOW,
    createdAt: NOW,
  },
  {
    id: 'conn-t2-square',
    tenantId: 't2',
    providerId: 'square',
    displayName: 'Other registers',
    status: 'ACTIVE',
    statusReason: null,
    lastSyncedAt: NOW,
    createdAt: NOW,
  },
];

/** AiService over the Toast venue's REAL MenuService and an in-memory bucket as its injected storage. */
async function buildPosService(opts: { stock?: any; redis?: any } = {}) {
  const catalog = await toastPhotoCatalog();
  const bucket = memoryBucket();
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 't1'
            ? {
                id: 't1',
                parentId: null,
                aiProvider: null,
                aiKeyEncrypted: null,
                aiModel: null,
              }
            : null,
        ),
        update: jest.fn(async () => ({})),
      },
      tenantBranding: { findUnique: jest.fn(async () => null) },
      template: { findMany: jest.fn(async () => []) },
      auditLog: {
        create: jest.fn(async ({ data }: any) => data),
        findMany: jest.fn(async () => []),
      },
      posProviderConnection: {
        findMany: jest.fn(async ({ where }: any) =>
          CONNECTIONS.filter((c) => where.tenantId.in.includes(c.tenantId)),
        ),
      },
    },
  };
  const stock = opts.stock ?? {
    isConfigured: () => true,
    search: jest.fn(async () => null),
  };
  const service = new AiService(
    prisma,
    opts.redis ?? ({ publisher: null } as any),
    bucket as any,
    { analyzeDesignReference: jest.fn() } as any,
    stock,
    catalog.menu as any,
  );
  return { service, bucket, stock, catalog };
}

/** The REAL CONTENT rows a draw was given: [item.N] rows + the photo each one came with. */
function rowsOf(userPrompt: string) {
  return parsePosBoundRows(userPrompt);
}

type Mistake = 'faithful' | 'swapped' | 'stock-and-invented' | 'frames';

/**
 * What a model draws for the rows it was given — faithfully, or with the
 * mistakes the binder must undo. Every row keeps the contract's text keys.
 */
function modelBoard(userPrompt: string, mistake: Mistake): string {
  const rows = rowsOf(userPrompt);
  const photos = rows.filter((r) => r.photo);
  const cards = rows
    .map((r, i) => {
      const name = r.line.split(' — ')[1];
      const price = r.line.split(' — ')[2];
      let media = '';
      if (mistake === 'faithful' && r.photo)
        media = `<div class="frame"><img data-imgslot="item.${r.n}.photo" src="${r.photo}" alt=""></div>`;
      if (mistake === 'swapped') {
        // Every row shows the NEXT photo in the list — photo rows swap, no-photo rows borrow.
        const other = photos[(i + 1) % photos.length];
        media = `<div class="frame"><img data-imgslot="item.${r.n}.photo" src="${other.photo}" alt=""></div>`;
      }
      if (mistake === 'stock-and-invented') {
        media = r.photo
          ? `<div class="frame"><img data-imgslot="item.${r.n}.photo" src="https://cdn.invented.example/dish-${r.n}.jpg" alt=""></div>`
          : `<div class="frame"><img data-imgslot="item.${r.n}.photo" src="https://images.pexels.com/photos/${1000 + r.n}/taco.jpeg" alt=""></div>`;
      }
      if (mistake === 'frames')
        media = `<div class="dish-photo" data-imgslot="item.${r.n}.image" data-img="item.${r.n}.image"><span class="glyph">*</span></div>`;
      return (
        `<article class="card" data-menu-row="${r.n}">${media}` +
        `<span class="nm" data-field="item.${r.n}.name">${name}</span>` +
        `<span class="pr" data-field="item.${r.n}.price">${price}</span></article>`
      );
    })
    .join('');
  return (
    '<!doctype html><html><head><style>.stage{width:3840px;height:2160px;position:relative}.card img{width:960px;height:640px;object-fit:cover}' +
    '.dish-photo[data-has-image="true"] .glyph{display:none}</style></head><body><div class="stage">' +
    `<h1 data-field="headline">Super Taco</h1><div class="cards">${cards}</div></div></body></html>`
  );
}

/** Answer each board draw with the next mistake in the list (the brief read gets '{}'). */
function scriptModel(mistakes: Mistake[]) {
  let board = 0;
  dispatchMock.mockImplementation(async (_p: any, input: any) => {
    if (input.maxTokens === 500) return { raw: '{}' };
    const mistake = mistakes[board % mistakes.length];
    board += 1;
    return {
      raw: modelBoard(String(input.userPrompt), mistake),
      model: 'gpt-6-sol',
    };
  });
}

/** Every <img> on a board as [its slot key, its src] (attribute order does not matter). */
function imagesOf(html: string): Array<[string | null, string | null]> {
  const attr = (tag: string, name: string) =>
    new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => [
    attr(m[0], 'data-imgslot'),
    attr(m[0], 'src'),
  ]);
}

const posGenerate = (service: AiService) =>
  service.generateDesignerBoardCandidates({
    tenantId: 't1',
    prompt: 'a menu board with our Toast menu',
    vertical: 'restaurant',
    screenWidth: 3840,
    screenHeight: 2160,
    posSelection: {
      connectionId: TOAST_CONNECTION_ID,
      sections: ['Tacos', 'Burritos'],
    },
  });

describe('POS item photos through generateDesignerBoardCandidates', () => {
  it("re-hosts the POS photos into AiService's own bucket BEFORE the draw, and every draw sees only OUR URLs", async () => {
    const cdn = await toastPhotoCdn();
    safeFetchMock.mockImplementation(cdn.fetch);
    const { service, bucket } = await buildPosService();
    scriptModel(['faithful']);
    await posGenerate(service);

    // The two POS photos that exist were copied (the 404 one was not), into ai-designer/t1/item-*.jpg.
    expect([...cdn.calls].sort()).toEqual(
      [
        TOAST_PHOTO_URLS.asada,
        TOAST_PHOTO_URLS.birria,
        TOAST_PHOTO_URLS.pastor,
      ].sort(),
    );
    expect(bucket.uploads).toHaveLength(2);
    expect(
      bucket.uploads.every((u) =>
        /^ai-designer\/t1\/item-[0-9a-f]{16}\.jpg$/.test(u.path),
      ),
    ).toBe(true);
    const ours = bucket.uploads.map(
      (u) => `https://sb.example/storage/v1/object/public/assets/${u.path}`,
    );

    const prompts = dispatchMock.mock.calls
      .filter((c) => c[1].maxTokens !== 500)
      .map((c) => String(c[1].userPrompt));
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p).not.toContain('toasttab');
      const rows = rowsOf(p);
      expect(rows).toHaveLength(5);
      expect(
        rows
          .filter((r) => r.photo)
          .map((r) => r.photo)
          .sort(),
      ).toEqual([...ours].sort());
      expect(p).toMatch(
        /- ITEM PHOTOS — 2 of the rows \(item\.\d and item\.\d\) end "photo: item\.N\.photo"/,
      );
      expect(p).toContain('A row without a photo gets no photo frame');
    }
  });

  it('whatever the model draws, every returned board shows each row its OWN photo or none', async () => {
    const cdn = await toastPhotoCdn();
    safeFetchMock.mockImplementation(cdn.fetch);
    const { service } = await buildPosService();
    scriptModel(['swapped', 'stock-and-invented', 'frames']);
    const out = await posGenerate(service);
    expect(out.candidates).toHaveLength(3);
    expect(out.boundTo).toEqual({
      providerId: 'toast',
      providerName: 'Toast',
      itemCount: 5,
    });

    const prompt = String(
      dispatchMock.mock.calls.find((c) => c[1].maxTokens !== 500)![1]
        .userPrompt,
    );
    const photoOf = new Map(rowsOf(prompt).map((r) => [r.n, r.photo ?? null]));
    for (const c of out.candidates) {
      expect(c.html).not.toMatch(/pexels|invented\.example|toasttab/);
      // Every bound row: the images inside its card are its own photo, or have no src.
      const slots = readMenuBindings(c.html).slots;
      expect(Object.keys(slots).sort()).toEqual([
        'item.0',
        'item.1',
        'item.2',
        'item.3',
        'item.4',
      ]);
      for (const [n, own] of photoOf) {
        const at = c.html.indexOf(`data-menu-row="${n}"`);
        const cardHtml = c.html.slice(
          c.html.lastIndexOf('<article', at),
          c.html.indexOf('</article>', at),
        );
        for (const [, src] of imagesOf(cardHtml)) expect(src).toBe(own ?? null);
        const frame = /<div class="dish-photo"[^>]*>/.exec(cardHtml)?.[0];
        if (frame) {
          expect(frame.includes('data-has-image="true"')).toBe(!!own);
          if (own) expect(frame).toContain(`background-image:url('${own}')`);
        }
      }
    }
  });

  it('a batch the hourly cap refuses never fetches or stores a photo (the copy runs after the caps)', async () => {
    const cdn = await toastPhotoCdn();
    safeFetchMock.mockImplementation(cdn.fetch);
    // The success window is full; the failure window is empty (so the refusal is the cap, after the plan).
    const redis = {
      publisher: {
        zremrangebyscore: jest.fn(async () => 0),
        zcard: jest.fn(async (key: string) => (key.startsWith('ai:rl:gen:') ? 10_000 : 0)),
        zadd: jest.fn(async () => 1),
        pexpire: jest.fn(async () => 1),
      },
    };
    const { service, bucket, catalog } = await buildPosService({ redis });
    const planRead = jest.spyOn(catalog.menu, 'resolvePosMenuForLocation');
    scriptModel(['faithful']);
    const err = await posGenerate(service).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/Hit the hourly AI cap/);
    // The plan WAS read (a bad selection is still a 422 first) …
    expect(planRead).toHaveBeenCalledWith('t1', {
      connectionId: TOAST_CONNECTION_ID,
      includeUnavailable: true,
      ignoreDayparts: true,
    });
    // … but no photo was fetched or copied, and nothing was drawn.
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(bucket.uploads).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('no stock photo is looked for, for any row', async () => {
    const cdn = await toastPhotoCdn();
    safeFetchMock.mockImplementation(cdn.fetch);
    const { service, stock } = await buildPosService();
    scriptModel(['faithful']);
    await posGenerate(service);
    expect(stock.search).not.toHaveBeenCalled();
  });
});

describe('a menu that is NOT POS-bound gets no per-item photos (a wrong dish is worse than none)', () => {
  it('auto-grounded from the same Toast catalog: nothing fetched, nothing stored, no photo URL or instruction', async () => {
    const { service, bucket, stock } = await buildPosService();
    dispatchMock.mockImplementation(async (_p: any, input: any) =>
      input.maxTokens === 500
        ? { raw: '{}' }
        : {
            raw:
              '<!doctype html><html><head><style>.stage{width:3840px;height:2160px}</style></head><body><div class="stage">' +
              '<h1 data-field="headline">Our Tacos</h1><div class="row"><img data-imgslot="item.0.image" src="https://images.pexels.com/photos/1/tacos.jpeg" alt="">' +
              '<span data-field="item.0.name">3 Birria Tacos w/ consome</span><span data-field="item.0.price">$14.50</span></div></div></body></html>',
            model: 'gpt-6-sol',
          },
    );
    const out = await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'a menu board for our tacos',
      vertical: 'restaurant',
      purpose: 'menu',
      screenWidth: 3840,
      screenHeight: 2160,
    });
    const prompts = dispatchMock.mock.calls
      .filter((c) => c[1].maxTokens !== 500)
      .map((c) => String(c[1].userPrompt));
    for (const p of prompts) {
      // The catalog grounded the board (names + prices) …
      expect(p).toContain("Real menu items from this venue's live POS menu");
      expect(p).toContain('3 Birria Tacos w/ consome — $14.50');
      // … and nothing about any item's photo reached the model.
      expect(p).not.toMatch(
        /toasttab|item\.N\.photo|ITEM PHOTOS|Item photos \(/,
      );
      expect(p).not.toContain('POS-BOUND MENU');
    }
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(bucket.uploads).toEqual([]);
    expect(stock.search).not.toHaveBeenCalled();
    // A stock photo the model put on a dish anyway never survives the sanitizer; its slot does.
    for (const c of out.candidates) {
      expect(c.html).not.toContain('pexels');
      expect(c.html).toContain('data-imgslot="item.0.image"');
    }
  });

  it('a site-read menu (content rows, no [item.N]): no per-item photo instruction either', async () => {
    const { service, bucket } = await buildPosService();
    dispatchMock.mockImplementation(async (_p: any, input: any) =>
      input.maxTokens === 500
        ? { raw: '{}' }
        : { raw: WELCOME_BOARD, model: 'gpt-6-sol' },
    );
    await service.generateDesignerBoardCandidates({
      tenantId: 't1',
      prompt: 'a menu board',
      purpose: 'menu',
      content: 'Tacos — Al Pastor — $4.25\nTacos — Carnitas — $4.25',
    });
    for (const p of dispatchMock.mock.calls
      .filter((c) => c[1].maxTokens !== 500)
      .map((c) => String(c[1].userPrompt))) {
      expect(p).not.toMatch(
        /ITEM PHOTOS|item\.N\.photo|None of these rows comes with a photo|A row without a photo/,
      );
    }
    expect(bucket.uploads).toEqual([]);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
