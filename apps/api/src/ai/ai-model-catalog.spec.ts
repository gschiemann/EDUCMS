/**
 * The AI model catalog — the rules that decide which model serves every call (2026-09-22).
 *
 * Pins Greg's ask directly: a newer release in a tier's family is adopted with no code change; a
 * cheaper one makes the same allowance go further (costMicros prices at the serving model); a
 * release that breaks the tier's price envelope, fails, or is about to retire is never picked.
 */
import {
  compareVersions,
  costMicros,
  familyOf,
  getCatalog,
  learnCapability,
  markModelFailed,
  ResolvedCatalog,
  SEED_MODELS,
  setCatalogState,
  DEFAULT_FAMILY_PATTERNS,
  type CatalogModel,
} from './ai-model-catalog';
import { tierForSavedChoice } from './ai-legacy-models';

const NOW = new Date('2026-09-22T12:00:00Z');

function feedModel(over: Partial<CatalogModel> & Pick<CatalogModel, 'provider' | 'id'>): CatalogModel {
  return {
    label: over.id,
    family: null,
    version: [],
    releasedAt: '2026-10-01',
    inputPer1M: 1,
    outputPer1M: 5,
    caps: { temperature: false, effort: null, effortLevels: [], reasoning: true, maxOutputTokens: null, vision: false },
    status: 'active',
    retiresAt: null,
    source: 'feed',
    ...over,
  };
}

afterEach(() => setCatalogState({}));

describe('families', () => {
  it('parses the version out of every evergreen id and refuses dated snapshots and variants', () => {
    expect(familyOf('anthropic', 'claude-opus-5-5', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'claude-opus', version: [5, 5] });
    expect(familyOf('anthropic', 'claude-sonnet-5', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'claude-sonnet', version: [5] });
    expect(familyOf('anthropic', 'claude-opus-4-5-20251101', DEFAULT_FAMILY_PATTERNS)).toBeNull();
    expect(familyOf('openai', 'gpt-5.6-sol', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'gpt-sol', version: [5, 6] });
    expect(familyOf('openai', 'gpt-5.6-sol-pro', DEFAULT_FAMILY_PATTERNS)).toBeNull();
    expect(familyOf('google', 'gemini-3.8-flash', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'gemini-flash', version: [3, 8] });
    expect(familyOf('google', 'gemini-3.5-flash-lite', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'gemini-flash-lite', version: [3, 5] });
    expect(familyOf('google', 'gemini-3.1-pro-preview', DEFAULT_FAMILY_PATTERNS)).toEqual({ family: 'gemini-pro', version: [3, 1] });
  });

  it('a malformed admin pattern is skipped, never thrown', () => {
    expect(familyOf('anthropic', 'claude-opus-5-5', [{ provider: 'anthropic', family: 'x', pattern: '([' }])).toBeNull();
  });

  it('orders versions numerically (5.10 is newer than 5.9)', () => {
    expect(compareVersions([5, 10], [5, 9])).toBeGreaterThan(0);
    expect(compareVersions([6], [5, 9])).toBeGreaterThan(0);
    expect(compareVersions([5], [5, 0])).toBe(0);
  });
});

describe('tier resolution', () => {
  it('seed lineup: Haiku 4.5 / Sonnet 5 / Opus 5.5 — every seed tier id is a real seed model', () => {
    const cat = new ResolvedCatalog({}, () => NOW);
    expect(cat.resolveTier('anthropic', 'standard').model.id).toBe('claude-haiku-4-5');
    expect(cat.resolveTier('anthropic', 'balanced').model.id).toBe('claude-sonnet-5');
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      for (const tier of ['standard', 'balanced', 'premium'] as const) {
        const m = cat.resolveTier(provider, tier).model;
        expect(SEED_MODELS.some((s) => s.provider === provider && s.id === m.id)).toBe(true);
      }
    }
  });

  it('a NEWER version in the family is adopted with no code change — the whole point', () => {
    const cat = new ResolvedCatalog(
      { models: [feedModel({ provider: 'anthropic', id: 'claude-opus-5-6', inputPer1M: 3, outputPer1M: 15 })] },
      () => NOW,
    );
    const { model, fallback } = cat.resolveTier('anthropic', 'premium');
    expect(model.id).toBe('claude-opus-5-6');
    expect(model.family).toBe('claude-opus');
    // ...and the previous verified version stands behind it for the first call.
    expect(fallback?.id).toBe('claude-opus-5-5');
  });

  it('a newer version PRICED OVER the tier ceiling is not auto-adopted (it waits for a human)', () => {
    const cat = new ResolvedCatalog(
      { models: [feedModel({ provider: 'anthropic', id: 'claude-opus-6', inputPer1M: 10, outputPer1M: 50 })] },
      () => NOW,
    );
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
    // ...unless an admin raises the envelope.
    const raised = new ResolvedCatalog(
      { models: [feedModel({ provider: 'anthropic', id: 'claude-opus-6', outputPer1M: 50 })], tierCeilings: { premium: 60 } },
      () => NOW,
    );
    expect(raised.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-6');
  });

  it('a FAILED model is skipped until the next sync clears it', () => {
    const cat = new ResolvedCatalog(
      {
        models: [feedModel({ provider: 'anthropic', id: 'claude-opus-5-6', outputPer1M: 15 })],
        failures: { 'anthropic:claude-opus-5-6': { at: NOW.toISOString(), error: '404' } },
      },
      () => NOW,
    );
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
  });

  it('a model within 14 days of its shutdown date is never picked', () => {
    const cat = new ResolvedCatalog(
      { models: [feedModel({ provider: 'anthropic', id: 'claude-opus-5-6', outputPer1M: 15, retiresAt: '2026-10-01' })] },
      () => NOW,
    );
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
  });

  it('a super-admin PIN beats "newest in family"; a pin to an unusable model is ignored', () => {
    const pinned = new ResolvedCatalog({ pins: { anthropic: { premium: 'claude-fable-5-1' } } }, () => NOW);
    expect(pinned.resolveTier('anthropic', 'premium').model.id).toBe('claude-fable-5-1');
    const bad = new ResolvedCatalog({ pins: { anthropic: { premium: 'claude-nope-1' } } }, () => NOW);
    expect(bad.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
  });

  it('fallback when the family has nothing else verified: the neighbouring tier (a board degrades, never fails)', () => {
    const cat = new ResolvedCatalog({}, () => NOW);
    expect(cat.resolveTier('anthropic', 'balanced').fallback?.id).toBe('claude-haiku-4-5');
    expect(cat.resolveTier('anthropic', 'premium').fallback?.id).toBe('claude-sonnet-5');
    expect(cat.resolveTier('anthropic', 'standard').fallback?.id).toBe('claude-sonnet-5');
  });

  it('a broken family pattern falls back to the seed model for the tier — never throws, never empty', () => {
    const cat = new ResolvedCatalog({ tierFamilies: { anthropic: { premium: 'no-such-family' } } }, () => NOW);
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
  });

  it('a feed can move a SEED model\'s price but never its verified request rules', () => {
    const cat = new ResolvedCatalog(
      {
        models: [
          feedModel({
            provider: 'anthropic',
            id: 'claude-haiku-4-5',
            inputPer1M: 0.8,
            outputPer1M: 4,
            caps: { temperature: false, effort: 'anthropic-output-config', effortLevels: ['low'], reasoning: true, maxOutputTokens: 1, vision: false },
          }),
        ],
      },
      () => NOW,
    );
    const m = cat.get('anthropic', 'claude-haiku-4-5')!;
    expect(m.outputPer1M).toBe(4);
    expect(m.caps.temperature).toBe(true);
    expect(m.caps.effort).toBeNull();
    expect(m.source).toBe('seed');
  });

  it('our key routes each JOB to a vendor: design prefers OpenAI Premium, then Google — and NEVER Claude by default', () => {
    const cat = new ResolvedCatalog({}, () => NOW);
    const all = () => true;
    const anthropicOnly = (p: string) => p === 'anthropic';
    expect(cat.routeForJob('fast', all)).toEqual({ provider: 'anthropic', tier: 'standard' });
    expect(cat.routeForJob('design', all)).toEqual({ provider: 'openai', tier: 'premium' });
    expect(cat.routeForJob('design', (p) => p !== 'openai')).toEqual({ provider: 'google', tier: 'premium' });
    // Greg, 2026-09-22: Claude does not touch design — an Anthropic-only deploy has no design route
    expect(cat.routeForJob('design', anthropicOnly)).toBeNull();
    expect(cat.platformRoutes.design.some((r) => r.provider === 'anthropic')).toBe(false);
    // …while the FAST job keeps Anthropic first
    expect(cat.routeForJob('fast', anthropicOnly)).toEqual({ provider: 'anthropic', tier: 'standard' });
    // a deploy holding ONLY an OpenAI key still has somewhere to run fast jobs
    expect(cat.routeForJob('fast', (p) => p === 'openai')).toEqual({ provider: 'openai', tier: 'standard' });
    expect(cat.routeForJob('design', () => false)).toBeNull();
    // design on OpenAI Premium is the Sol family: GPT-6 Sol, with GPT-5.6 Sol verified behind it
    const r = cat.routeForJob('design', all)!;
    expect(cat.resolveTier(r.provider, r.tier).model.id).toBe('gpt-6-sol');
    expect(cat.resolveTier(r.provider, r.tier).fallback?.id).toBe('gpt-5.6-sol');
    // …and the next Sol a vendor feed brings in takes over with no code change
    const withSol7 = new ResolvedCatalog(
      { models: [feedModel({ provider: 'openai', id: 'gpt-7-sol', inputPer1M: 2, outputPer1M: 10, status: 'unverified' })] },
      () => NOW,
    );
    expect(withSol7.resolveTier('openai', 'premium').model.id).toBe('gpt-7-sol');
    expect(withSol7.resolveTier('openai', 'premium').fallback?.id).toBe('gpt-6-sol');
  });

  it('Super Admin routes win; a partial list is completed with the defaults for the vendors it omits', () => {
    const cat = new ResolvedCatalog({ platformRoutes: { design: [{ provider: 'anthropic', tier: 'premium' }] } }, () => NOW);
    expect(cat.platformRoutes.design).toEqual([
      { provider: 'anthropic', tier: 'premium' },
      { provider: 'openai', tier: 'premium' },
      { provider: 'google', tier: 'premium' },
    ]);
    expect(cat.routeForJob('design', () => true)).toEqual({ provider: 'anthropic', tier: 'premium' });
    // garbage in state is ignored, never thrown
    const junk = new ResolvedCatalog({ platformRoutes: { design: [{ provider: 'nope', tier: 'x' } as any] } }, () => NOW);
    expect(junk.routeForJob('design', () => true)).toEqual({ provider: 'openai', tier: 'premium' });
  });

  it('the legacy tier-only setting (platformJobs) still reads for FAST jobs; it no longer puts Claude on DESIGN', () => {
    const legacyFast = new ResolvedCatalog({ platformJobs: { fast: 'balanced' } }, () => NOW);
    expect(legacyFast.routeForJob('fast', () => true)).toEqual({ provider: 'anthropic', tier: 'balanced' });
    const legacy = new ResolvedCatalog({ platformJobs: { design: 'premium' } }, () => NOW);
    expect(legacy.routeForJob('design', () => true)).toEqual({ provider: 'openai', tier: 'premium' });
    expect(legacy.platformRoutes.design.some((r) => r.provider === 'anthropic')).toBe(false);
    // an owner who deliberately LISTS a Claude tier for design still gets it (a choice, not a default)
    const chosen = new ResolvedCatalog({ platformRoutes: { design: [{ provider: 'anthropic', tier: 'premium' }] } }, () => NOW);
    expect(chosen.routeForJob('design', () => true)).toEqual({ provider: 'anthropic', tier: 'premium' });
    // an explicit route list beats the legacy field
    const both = new ResolvedCatalog(
      { platformJobs: { design: 'premium' }, platformRoutes: { design: [{ provider: 'openai', tier: 'premium' }] } },
      () => NOW,
    );
    expect(both.routeForJob('design', () => true)).toEqual({ provider: 'openai', tier: 'premium' });
  });

  it('effort: the job level when offered, else the cheapest level the model has, else none', () => {
    const cat = new ResolvedCatalog({}, () => NOW);
    // design = the MID level (Greg, 2026-09-22: "use the mid level"); fast stays low
    expect(cat.effortFor(cat.get('anthropic', 'claude-opus-5-5')!, 'design')).toBe('medium');
    expect(cat.effortFor(cat.get('openai', 'gpt-6-sol')!, 'design')).toBe('medium');
    expect(cat.effortFor(cat.get('openai', 'gpt-6-luna')!, 'fast')).toBe('low');
    expect(cat.effortFor(cat.get('anthropic', 'claude-haiku-4-5')!, 'fast')).toBeNull();
    const medium = feedModel({
      provider: 'openai',
      id: 'x',
      caps: { temperature: false, effort: 'openai-reasoning-effort', effortLevels: ['high', 'medium'], reasoning: true, maxOutputTokens: null, vision: false },
    });
    expect(cat.effortFor(medium, 'fast')).toBe('medium');
  });

  it('image models are data with a best-first default', () => {
    expect(getCatalog().imageModels('openai')[0]).toBe('gpt-image-2.5-sunburst');
    setCatalogState({ imageModels: { openai: ['gpt-image-2'] } });
    expect(getCatalog().imageModels('openai')).toEqual(['gpt-image-2']);
  });
});

describe('cost — the unit the allowance is metered in', () => {
  it('prices tokens at the serving model: 10k in + 8k out on Sonnet 5 = $0.10', () => {
    expect(costMicros('anthropic', 'claude-sonnet-5', { inputTokens: 10_000, outputTokens: 8_000 })).toBe(100_000);
  });
  it('the SAME work on a cheaper model costs less — so the same allowance buys more', () => {
    const opus = costMicros('anthropic', 'claude-opus-5-5', { inputTokens: 10_000, outputTokens: 8_000 });
    const sonnet = costMicros('anthropic', 'claude-sonnet-5', { inputTokens: 10_000, outputTokens: 8_000 });
    expect(opus).toBe(200_000);
    expect(sonnet).toBeLessThan(opus);
  });
  it('prompt-cache reads bill at 0.1× input, writes at 1.25× input', () => {
    expect(costMicros('anthropic', 'claude-haiku-4-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000, cacheWriteTokens: 1_000 })).toBe(
      1_000 + 1_250,
    );
  });
  it('each model\'s OWN cache rates (vendor pricing pages, 2026-09-22) — never under-counted', () => {
    const reads = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 };
    // Opus 5.5 reads at 0.05x ($0.20 vs $4), Fable 5.1 at 0.025x ($0.25 vs $10)
    expect(costMicros('anthropic', 'claude-opus-5-5', reads)).toBe(200_000);
    expect(costMicros('anthropic', 'claude-fable-5-1', reads)).toBe(250_000);
    // GPT-6 Sol: reads 0.1x ($0.20), writes 1.25x ($2.50)
    expect(costMicros('openai', 'gpt-6-sol', reads)).toBe(200_000);
    expect(costMicros('openai', 'gpt-6-sol', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBe(2_500_000);
    // an OLDER OpenAI model has its own read rate — gpt-4o-mini $0.075 = 0.5x, never the GPT-6 0.1x
    expect(costMicros('openai', 'gpt-4o-mini', reads)).toBe(75_000);
    // an unknown id takes no model-specific discount (priced as the dearest model, reads at 0.1x)
    expect(costMicros('anthropic', 'claude-mystery', reads)).toBe(1_000_000);
  });
  it('an UNPRICED id is billed as the vendor\'s most expensive known model, never as free', () => {
    const unknown = costMicros('anthropic', 'claude-mystery', { inputTokens: 1_000, outputTokens: 1_000 });
    expect(unknown).toBe(costMicros('anthropic', 'claude-fable-5-1', { inputTokens: 1_000, outputTokens: 1_000 }));
    expect(unknown).toBeGreaterThan(0);
  });
});

describe('lessons from live traffic', () => {
  it('learnCapability and markModelFailed change resolution in this process immediately', () => {
    setCatalogState({ models: [feedModel({ provider: 'anthropic', id: 'claude-opus-5-6', outputPer1M: 15 })] });
    expect(getCatalog().resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-6');
    markModelFailed('anthropic', 'claude-opus-5-6', 'refused');
    expect(getCatalog().resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
    learnCapability('anthropic', 'claude-haiku-4-5', { temperature: false });
    expect(getCatalog().get('anthropic', 'claude-haiku-4-5')!.caps.temperature).toBe(false);
  });
});

describe('saved choices → tiers (ai-legacy-models)', () => {
  it('reads tier keys, legacy ids (as the tier they were OFFERED in), family ids, and garbage', () => {
    expect(tierForSavedChoice('openai', 'premium')).toBe('premium');
    expect(tierForSavedChoice('openai', 'gpt-5')).toBe('premium');
    expect(tierForSavedChoice('openai', 'gpt-4.1')).toBe('balanced');
    expect(tierForSavedChoice('google', 'gemini-2.5-flash')).toBe('standard');
    expect(tierForSavedChoice('anthropic', 'claude-sonnet-5')).toBe('balanced');
    expect(tierForSavedChoice('anthropic', 'claude-opus-7')).toBe('premium');
    expect(tierForSavedChoice('anthropic', 'whatever')).toBe('standard');
    expect(tierForSavedChoice('anthropic', null)).toBe('standard');
  });
});
