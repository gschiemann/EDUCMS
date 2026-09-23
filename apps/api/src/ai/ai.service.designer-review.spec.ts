/**
 * AiService — the AI Designer LOOKS at its boards (2026-09-23, Codex finding 3).
 *
 * draw → static checks (one redraw for a blocker) → render → critique → ONE
 * surgical revise → re-render → the better-measuring board ships.
 *
 * Only the vendor dispatch (`dispatchAi`) and the renderer's two network edges
 * are faked: the renderer answers with REAL responses cut from the renderer
 * (__fixtures__/renderer, see designer-review.spec.ts), chosen by what the
 * posted document contains; the client, the document assembly, the scoring and
 * the keep rule are the real code.
 */
jest.mock('./ai-providers', () => {
  const actual = jest.requireActual('./ai-providers');
  return { ...actual, dispatchAi: jest.fn() };
});
import fs from 'node:fs';
import path from 'node:path';
import { dispatchAi } from './ai-providers';
import { AiService } from './ai.service';
import { DesignerRendererClient } from './designer-renderer.client';
import { DESIGNER_CRITIQUE_SYSTEM_PROMPT } from './designer-review';
import {
  DesignerGenerationCancelled,
  type DesignerProgress,
} from './designer-generation-hooks';
import { DESIGNER_PER_CANDIDATE_MARKER } from './designer-prompt';

const dispatchMock = dispatchAi as unknown as jest.Mock;
const fixture = (name: string) =>
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'renderer', `${name}.response.json`),
    'utf8',
  );
const RENDER_CROWDED = fixture('crowded-ai-board'); // score 75, one blocker
const RENDER_GOOD = fixture('exemplar-menu-hero-cards'); // score 90, no blocker
const RENDER_BAD = fixture('bad-board'); // score 52, two blockers

const SUPA = 'https://abc.supabase.co';
const LOGO = `${SUPA}/storage/v1/object/public/assets/ai-designer/t1/logo-1a2b.png`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const doc = (words: string) =>
  '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:relative}</style></head>' +
  `<body><div class="stage"><h1 data-field="headline">Chrome Coffee</h1><p data-field="subhead">${words}</p></div></body></html>`;
const DRAFT = doc(
  'Fresh roasted every morning, all day long, right here downtown.',
);
const REVISED = doc(
  'REVISED — fresh roasted every morning, all day long, right here downtown.',
);

type Script = {
  draw?: (attempt: number, input: any) => any;
  critic?: () => string;
  revise?: () => any;
};
function scriptModel(s: Script = {}) {
  let draws = 0;
  dispatchMock.mockImplementation(async (_p: any, input: any) => {
    if (input.maxTokens === 500) return { raw: '{}', truncated: false };
    if (input.system === DESIGNER_CRITIQUE_SYSTEM_PROMPT) {
      return {
        raw: s.critic
          ? s.critic()
          : JSON.stringify({
              verdict: 'revise',
              score: 60,
              defects: [
                {
                  severity: 'major',
                  where: 'subhead',
                  what: 'too long',
                  fix: 'shorten',
                },
              ],
            }),
        model: 'gpt-6-sol',
        usage: { inputTokens: 3000, outputTokens: 400 },
        truncated: false,
      };
    }
    if (
      String(input.userPrompt).includes(
        'You are REVISING an existing signage board',
      )
    ) {
      return s.revise
        ? s.revise()
        : {
            raw: REVISED,
            model: 'gpt-6-sol',
            usage: { inputTokens: 20000, outputTokens: 9000 },
            truncated: false,
          };
    }
    draws += 1;
    return s.draw
      ? s.draw(draws, input)
      : {
          raw: DRAFT,
          model: 'gpt-6-sol',
          usage: { inputTokens: 14000, outputTokens: 9000 },
          truncated: false,
        };
  });
}

/** The renderer answers by what it is shown: the revision one way, the draft another. */
function renderer(
  opts: { draft?: string; revised?: string; status?: number } = {},
) {
  const posts: string[] = [];
  const fetchMock = jest.fn(async (_url: string, init: any) => {
    const html = JSON.parse(init.body).html as string;
    posts.push(html);
    if (opts.status) {
      return {
        ok: false,
        status: opts.status,
        json: async () => ({
          contractVersion: 1,
          error: 'render_timeout',
          message: 'x',
        }),
      } as any;
    }
    const body = html.includes('REVISED')
      ? (opts.revised ?? RENDER_GOOD)
      : (opts.draft ?? RENDER_CROWDED);
    return { ok: true, status: 200, json: async () => JSON.parse(body) } as any;
  });
  const safeFetchMock = jest.fn(async (url: string) => ({
    body: PNG,
    contentType: 'image/png',
    finalUrl: url,
    status: 200,
  }));
  const client = new DesignerRendererClient({
    fetch: fetchMock as any,
    safeFetch: safeFetchMock as any,
    env: {
      RENDERER_URL: 'http://renderer.railway.internal:8080',
      SUPABASE_URL: SUPA,
    },
    log: () => {},
  });
  return { client, fetchMock, safeFetchMock, posts };
}

const auditRows: any[] = [];
function buildService(client: DesignerRendererClient, adds: string[] = []) {
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 't1'
            ? {
                id: 't1',
                name: 'T1',
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
        create: jest.fn(async ({ data }: any) => {
          auditRows.push(data);
          return data;
        }),
        findMany: jest.fn(async () => []),
      },
    },
  };
  const redis: any = {
    publisher: {
      zremrangebyscore: jest.fn(async () => 0),
      zcard: jest.fn(async () => 0),
      zadd: jest.fn(async (key: string) => {
        adds.push(key);
        return 1;
      }),
      pexpire: jest.fn(async () => 1),
    },
  };
  const menu: any = {
    resolveMenuForLocation: jest.fn(async () => ({ items: [] })),
    resolvePosMenuForLocation: jest.fn(async () => ({ items: [] })),
  };
  const stock: any = { isConfigured: () => false, search: async () => null };
  return new AiService(
    prisma,
    redis,
    {} as any,
    { analyzeDesignReference: jest.fn() } as any,
    stock,
    menu,
    undefined,
    undefined,
    client,
  );
}

// The fixtures were rendered at 3840 × 2160, so the boards are judged on that canvas's floor (52 px).
const OPTS = {
  tenantId: 't1',
  prompt: 'a coffee menu board',
  vertical: 'restaurant',
  venueName: 'Chrome Coffee',
  purpose: 'menu',
  screenWidth: 3840,
  screenHeight: 2160,
};
const calls = (feature?: string) =>
  dispatchMock.mock.calls.filter(([, input]) => {
    if (input.maxTokens === 500) return false;
    const isCritic = input.system === DESIGNER_CRITIQUE_SYSTEM_PROMPT;
    const isRevise = String(input.userPrompt).includes(
      'You are REVISING an existing signage board',
    );
    if (feature === 'critique') return isCritic;
    if (feature === 'revise') return isRevise;
    if (feature === 'draw') return !isCritic && !isRevise;
    return true;
  });
const lastAudit = () =>
  JSON.parse(
    auditRows.filter((r) => r.action === 'AI_DESIGNER_CANDIDATES').slice(-1)[0]
      .details,
  );

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-openai-platform';
  delete process.env.ANTHROPIC_API_KEY;
  auditRows.length = 0;
  dispatchMock.mockReset();
});
afterAll(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('the look-and-fix loop', () => {
  it('a board with a measured blocker is critiqued, revised once, re-rendered — and the better board ships', async () => {
    const r = renderer();
    const adds: string[] = [];
    scriptModel();
    const out = await buildService(
      r.client,
      adds,
    ).generateDesignerBoardCandidates(OPTS);
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) {
      expect(c.html).toContain('REVISED');
      expect(c.review).toEqual({ reviewed: true, revised: true, score: 90 });
    }
    expect(calls('draw')).toHaveLength(3);
    expect(calls('critique')).toHaveLength(3);
    expect(calls('revise')).toHaveLength(3);
    // The critic and the reviser SEE the board: the screenshot rides as an image part.
    for (const [, input] of [...calls('critique'), ...calls('revise')]) {
      expect(input.images).toEqual([
        expect.objectContaining({ mediaType: 'image/webp', detail: 'high' }),
      ]);
      expect(input.job).toBe('design');
    }
    // The draft AND the revision were rendered: 6 posts, each the document a screen gets.
    expect(r.posts).toHaveLength(6);
    expect(
      r.posts.every(
        (p) => p.includes('/*VOS-STAGE-SCALE*/') && p.includes('data-vos-csp'),
      ),
    ).toBe(true);
    // A revise is a board drawn: 3 draws + 3 revises in the hourly window.
    expect(adds.filter((k) => k === 'ai:rl:gen:t1')).toHaveLength(6);
    const audit = lastAudit();
    expect(audit.reviewEnabled).toBe(true);
    expect(audit.boards[0].review).toMatchObject({
      rendered: true,
      verdictBefore: 'revise',
      scoreBefore: 75,
      revisionAttempted: true,
      revised: true,
      verdictAfter: 'revision-kept',
      scoreAfter: 90,
    });
    expect(audit.boards[0].review.metricsBefore).toMatchObject({
      clipped: 1,
      emptyRatio: 0.625,
    });
    expect(audit.boards[0].review.reviewCostUsd).toBeGreaterThan(0);
  });

  it('a revision that measures WORSE loses — the original ships', async () => {
    const r = renderer({ draft: RENDER_GOOD, revised: RENDER_BAD });
    scriptModel(); // the critic asks for a revise
    const out = await buildService(r.client).generateDesignerBoardCandidates(
      OPTS,
    );
    for (const c of out.candidates) {
      expect(c.html).not.toContain('REVISED');
      expect(c.review).toEqual({ reviewed: true, revised: false, score: 90 });
    }
    expect(lastAudit().boards[0].review).toMatchObject({
      scoreBefore: 90,
      scoreAfter: 52,
      verdictAfter: 'original-kept',
    });
  });

  it('a revision cut off mid-document fails the sanitizer — the original ships, never fewer boards', async () => {
    const r = renderer();
    scriptModel({
      revise: () => ({
        raw: REVISED.slice(0, REVISED.indexOf('</body>')),
        truncated: true,
        usage: { inputTokens: 1, outputTokens: 40000 },
      }),
    });
    const out = await buildService(r.client).generateDesignerBoardCandidates(
      OPTS,
    );
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates)
      expect(c.review).toEqual({ reviewed: true, revised: false, score: 75 });
    expect(lastAudit().boards[0].review.reason).toMatch(/^revise: /);
  });

  it('a passing critique and no measured blocker: no revise at all', async () => {
    const r = renderer({ draft: RENDER_GOOD });
    scriptModel({
      critic: () => '```json\n{"verdict":"pass","score":92,"defects":[]}\n```',
    });
    const out = await buildService(r.client).generateDesignerBoardCandidates(
      OPTS,
    );
    expect(calls('revise')).toHaveLength(0);
    for (const c of out.candidates)
      expect(c.review).toEqual({ reviewed: true, revised: false, score: 90 });
  });

  it('an unreadable critique is a pass — it never blocks, and never forces a revise', async () => {
    const r = renderer({ draft: RENDER_GOOD });
    scriptModel({ critic: () => 'Looks lovely!' });
    await buildService(r.client).generateDesignerBoardCandidates(OPTS);
    expect(calls('revise')).toHaveLength(0);
    expect(lastAudit().boards[0].review.verdictBefore).toBe('unparsed');
  });

  it('a renderer outage (504) skips the review — the boards still ship, unreviewed', async () => {
    const r = renderer({ status: 504 });
    scriptModel();
    const out = await buildService(r.client).generateDesignerBoardCandidates(
      OPTS,
    );
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) {
      expect(c.html).toBe(out.candidates[0].html);
      expect(c.review).toEqual({ reviewed: false, revised: false });
    }
    expect(calls('critique')).toHaveLength(0);
    expect(lastAudit().boards[0].review.reason).toBe(
      'render: HTTP 504 render_timeout',
    );
  });

  it('progress: per candidate drawing → binding → rendering → reviewing → revising → rendering → done', async () => {
    const r = renderer();
    scriptModel();
    const events: DesignerProgress[] = [];
    await buildService(r.client).generateDesignerBoardCandidates(
      { ...OPTS, count: 1 },
      { onProgress: (p) => events.push(p) },
    );
    expect(
      events.map((e) => `${e.stage}${e.candidate ? `#${e.candidate}` : ''}`),
    ).toEqual([
      'drawing',
      'drawing#1',
      'binding#1',
      'rendering#1',
      'reviewing#1',
      'revising#1',
      'rendering#1',
      'done#1',
      'done',
    ]);
  });

  it('cancellation between stages throws DesignerGenerationCancelled — never mid-request', async () => {
    const r = renderer();
    scriptModel();
    const ac = new AbortController();
    const run = buildService(r.client).generateDesignerBoardCandidates(OPTS, {
      signal: ac.signal,
      onProgress: (p) => {
        if (p.stage === 'reviewing') ac.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(DesignerGenerationCancelled);
    // The critiques that were already asked for finished; no revise was ever started.
    expect(calls('revise')).toHaveLength(0);
  });

  it('PROMPT CACHE: one reference set, and every draw and the revise share a byte-identical prefix', async () => {
    const r = renderer();
    scriptModel();
    await buildService(r.client).generateDesignerBoardCandidates(OPTS);
    const draws = calls('draw').map(([, i]) => i);
    const revise = calls('revise')[0][1];
    const prefix = String(draws[0].userPrompt).slice(
      0,
      String(draws[0].userPrompt).indexOf(DESIGNER_PER_CANDIDATE_MARKER),
    );
    expect(prefix.startsWith('REFERENCE BOARDS')).toBe(true);
    expect(prefix.length).toBeGreaterThan(10_000);
    for (const i of draws) {
      expect(
        i.userPrompt.startsWith(prefix + DESIGNER_PER_CANDIDATE_MARKER),
      ).toBe(true);
      expect(i.system).toBe(draws[0].system);
    }
    expect(revise.userPrompt.startsWith(prefix + '\n\nYou are REVISING')).toBe(
      true,
    );
    expect(revise.system).toBe(draws[0].system);
  });
});

describe('the static checks (renderer on or off)', () => {
  it('a draft cut off at the output ceiling is redrawn ONCE, told so', async () => {
    const off = new DesignerRendererClient({ env: {} });
    scriptModel({
      draw: (n) =>
        n === 1
          ? {
              raw: DRAFT.slice(0, DRAFT.indexOf('</body>')),
              truncated: true,
              usage: { inputTokens: 1, outputTokens: 40000 },
            }
          : {
              raw: DRAFT,
              truncated: false,
              usage: { inputTokens: 1, outputTokens: 9000 },
            },
    });
    const out = await buildService(off).generateDesignerBoardCandidates({
      ...OPTS,
      count: 1,
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].review).toBeUndefined(); // renderer off
    const prompts = calls('draw').map(([, i]) => String(i.userPrompt));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      'IMPORTANT — your previous answer was cut off after 40000 tokens before the document ended',
    );
    expect(lastAudit()).toMatchObject({
      staticRedraws: 1,
      reviewEnabled: false,
    });
    expect(lastAudit().boards[0]).toMatchObject({
      redrawn: true,
      truncated: false,
    });
  });

  it('cut off twice → that board is dropped (never half a board)', async () => {
    const off = new DesignerRendererClient({ env: {} });
    scriptModel({
      draw: () => ({
        raw: DRAFT.slice(0, DRAFT.indexOf('</body>')),
        truncated: true,
      }),
    });
    await expect(
      buildService(off).generateDesignerBoardCandidates({ ...OPTS, count: 1 }),
    ).rejects.toBeDefined();
  });
});

describe('draw-time vision', () => {
  it('a logo on OUR storage rides the draw as an image part (high detail), and the prompt says so', async () => {
    const r = renderer({ draft: RENDER_GOOD });
    scriptModel({ critic: () => '{"verdict":"pass","score":90,"defects":[]}' });
    await buildService(r.client).generateDesignerBoardCandidates({
      ...OPTS,
      logoUrl: LOGO,
    });
    for (const [, i] of calls('draw')) {
      expect(i.images).toEqual([
        {
          mediaType: 'image/png',
          base64: PNG.toString('base64'),
          detail: 'high',
        },
      ]);
      expect(i.userPrompt).toContain(
        'The logo above is attached as an image so you can see it',
      );
    }
    expect(lastAudit().drawImages).toEqual(['logo']);
  });

  it('a logo anywhere else is never fetched and nothing is attached', async () => {
    const r = renderer({ draft: RENDER_GOOD });
    scriptModel({ critic: () => '{"verdict":"pass","score":90,"defects":[]}' });
    await buildService(r.client).generateDesignerBoardCandidates({
      ...OPTS,
      logoUrl: 'https://www.venue.example/logo.png',
    });
    expect(r.safeFetchMock).not.toHaveBeenCalled();
    for (const [, i] of calls('draw')) {
      expect(i.images).toBeUndefined();
      expect(i.userPrompt).not.toContain('attached as an image');
    }
  });
});
