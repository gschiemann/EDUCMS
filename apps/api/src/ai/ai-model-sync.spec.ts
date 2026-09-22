/**
 * Catalog sync decisions (ai-model-sync.ts), against a fixture CUT FROM THE REAL FEEDS on
 * 2026-09-22 (__fixtures__/model-feeds.2026-09-22.json — verbatim entries, never hand-written).
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyCanaryResults, mergeFeeds, parseLiteLlm, parseOpenRouter } from './ai-model-sync';
import { ResolvedCatalog, type CatalogState } from './ai-model-catalog';

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'model-feeds.2026-09-22.json'), 'utf8'));
const NOW = new Date('2026-09-22T12:00:00Z');

describe('feed parsers (real payloads)', () => {
  const or = parseOpenRouter(fx.openrouter);
  const ll = parseLiteLlm(fx.litellm);

  it('OpenRouter: our three vendors only, no :batch variants, Anthropic dots → native dashes', () => {
    const ids = or.map((m) => `${m.provider}:${m.id}`);
    expect(ids).toContain('anthropic:claude-opus-5-5');
    expect(ids).toContain('openai:gpt-5.6-sol');
    expect(ids).toContain('google:gemini-3.8-flash');
    expect(ids.some((i) => i.includes(':batch'))).toBe(false);
    expect(ids.some((i) => i.startsWith('xiaomi'))).toBe(false);
    const opus = or.find((m) => m.id === 'claude-opus-5-5')!;
    expect(opus.inputPer1M).toBe(4);
    expect(opus.outputPer1M).toBe(20);
    // OpenRouter's `created` is when IT listed the model (the vendor's own date is 2026-09-21) —
    // close enough to order versions, which is all releasedAt is used for.
    expect(opus.releasedAt).toBe('2026-09-22');
    expect(opus.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(opus.vision).toBe(true);
  });

  it('LiteLLM: chat models only (the Responses-only pro model and image models are skipped), gemini/ prefix stripped', () => {
    const ids = ll.map((m) => `${m.provider}:${m.id}`);
    expect(ids).toContain('google:gemini-3.8-flash');
    expect(ids).toContain('openai:gpt-5.6-sol');
    expect(ids).not.toContain('openai:gpt-5.5-pro');
    expect(ids.some((i) => i.includes('gpt-image'))).toBe(false);
    expect(ll.find((m) => m.id === 'gpt-5.6-luna')!.inputPer1M).toBe(0.2);
  });

  it('garbage in → empty out, never a throw', () => {
    expect(parseOpenRouter(null)).toEqual([]);
    expect(parseOpenRouter({ data: 'x' })).toEqual([]);
    expect(parseLiteLlm('x')).toEqual([]);
  });
});

describe('mergeFeeds', () => {
  const openrouter = parseOpenRouter(fx.openrouter);
  const litellm = parseLiteLlm(fx.litellm);

  it('the real feeds agree with the seed lineup — no tier moves on day one', () => {
    const { report } = mergeFeeds({ current: {}, openrouter, litellm, now: NOW });
    expect(report.adopted).toEqual([]);
  });

  it('a price the feeds DISAGREE on is reported, and the HIGHER one is used (metering never under-counts)', () => {
    // OpenRouter lists gpt-5.6-sol at $2/$10; OpenAI + LiteLLM say $4/$20 — the real day-one disagreement.
    const { state, report } = mergeFeeds({ current: {}, openrouter, litellm, now: NOW });
    expect(report.disagreements.some((d) => d.id === 'gpt-5.6-sol')).toBe(true);
    const sol = new ResolvedCatalog(state, () => NOW).get('openai', 'gpt-5.6-sol')!;
    expect(sol.inputPer1M).toBe(4);
    expect(sol.outputPer1M).toBe(20);
  });

  it('a model in ONE feed only is ignored (a rumour); a model matching no family is reported, not adopted', () => {
    const { state, report } = mergeFeeds({ current: {}, openrouter, litellm: litellm.filter((m) => m.id !== 'claude-sonnet-5'), now: NOW });
    expect((state.models || []).some((m) => m.id === 'claude-sonnet-5')).toBe(false);
    // (with both feeds it IS merged — the negative control for the line above)
    expect((mergeFeeds({ current: {}, openrouter, litellm, now: NOW }).state.models || []).some((m) => m.id === 'claude-sonnet-5')).toBe(true);
    // gpt-5.4 (no tier suffix) is in both feeds and matches no family — but it shipped in March,
    // so it is not news; a model like it released LAST WEEK is.
    expect(report.unassigned).not.toContain('openai:gpt-5.4');
    const fresh = { provider: 'openai' as const, id: 'gpt-7-nova', inputPer1M: 3, outputPer1M: 15, releasedAt: '2026-09-15' };
    const fresh2 = mergeFeeds({ current: {}, openrouter: [...openrouter, fresh], litellm: [...litellm, { ...fresh }], now: NOW });
    expect(fresh2.report.unassigned).toEqual(['openai:gpt-7-nova']);
    // …and a fresh AUDIO model is never news for a text tier.
    const audio = { ...fresh, id: 'gpt-7-audio' };
    expect(mergeFeeds({ current: {}, openrouter: [...openrouter, audio], litellm: [...litellm, { ...audio }], now: NOW }).report.unassigned).toEqual([]);
  });

  it('a NEW version appearing in both feeds takes over its tier — as UNVERIFIED, queued for a canary', () => {
    const newOpus = { provider: 'anthropic' as const, id: 'claude-opus-5-6', inputPer1M: 3, outputPer1M: 15, releasedAt: '2026-10-20', effortLevels: ['low', 'medium', 'high'] };
    const { state, report } = mergeFeeds({
      current: {},
      openrouter: [...openrouter, newOpus],
      litellm: [...litellm, { ...newOpus }],
      now: NOW,
    });
    expect(report.added).toContain('anthropic:claude-opus-5-6');
    expect(report.adopted).toContainEqual({ provider: 'anthropic', tier: 'premium', from: 'claude-opus-5-5', to: 'claude-opus-5-6' });
    expect(report.needsCanary).toContainEqual({ provider: 'anthropic', id: 'claude-opus-5-6' });
    const m = new ResolvedCatalog(state, () => NOW).get('anthropic', 'claude-opus-5-6')!;
    expect(m.status).toBe('unverified');
    // a feed-only model gets the conservative shape: no temperature, the feed's effort levels
    expect(m.caps.temperature).toBe(false);
    expect(m.caps.effort).toBe('anthropic-output-config');
    expect(m.caps.effortLevels).toEqual(['low', 'medium', 'high']);
  });

  it('the vendor\'s own model list is the authority: a feed model our key cannot see is skipped', () => {
    const newOpus = { provider: 'anthropic' as const, id: 'claude-opus-5-6', inputPer1M: 3, outputPer1M: 15 };
    const { report } = mergeFeeds({
      current: {},
      openrouter: [...openrouter, newOpus],
      litellm: [...litellm, { ...newOpus }],
      vendorIds: { anthropic: new Set(['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5']) },
      now: NOW,
    });
    expect(report.added).not.toContain('anthropic:claude-opus-5-6');
    expect(report.adopted).toEqual([]);
  });

  it('a failed canary drops the new version and the tier stays where it was', () => {
    const newOpus = { provider: 'anthropic' as const, id: 'claude-opus-5-6', inputPer1M: 3, outputPer1M: 15, releasedAt: '2026-10-20' };
    const { state } = mergeFeeds({ current: {}, openrouter: [...openrouter, newOpus], litellm: [...litellm, { ...newOpus }], now: NOW });
    const after = applyCanaryResults(state, [{ provider: 'anthropic', id: 'claude-opus-5-6', ok: false, error: '400 bad' }], NOW);
    expect(new ResolvedCatalog(after, () => NOW).resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-5');
    const passed = applyCanaryResults(state, [{ provider: 'anthropic', id: 'claude-opus-5-6', ok: true }], NOW);
    const cat = new ResolvedCatalog(passed, () => NOW);
    expect(cat.resolveTier('anthropic', 'premium').model.id).toBe('claude-opus-5-6');
    expect(cat.get('anthropic', 'claude-opus-5-6')!.status).toBe('active');
  });

  it('a price CUT that both feeds agree on lands — the "cheaper model → more usage" path', () => {
    const cut = (m: any) => (m.id === 'claude-sonnet-5' ? { ...m, inputPer1M: 1.5, outputPer1M: 7.5 } : m);
    const { state, report } = mergeFeeds({ current: {}, openrouter: openrouter.map(cut), litellm: litellm.map(cut), now: NOW });
    expect(report.priceChanges).toContainEqual({ provider: 'anthropic', id: 'claude-sonnet-5', from: [2, 10], to: [1.5, 7.5] });
    expect(new ResolvedCatalog(state, () => NOW).get('anthropic', 'claude-sonnet-5')!.outputPer1M).toBe(7.5);
  });

  it('keeps what a super admin set (pins, jobs) through a sync', () => {
    const current: CatalogState = { pins: { anthropic: { premium: 'claude-fable-5-1' } }, platformJobs: { design: 'premium' } };
    const { state } = mergeFeeds({ current, openrouter, litellm, now: NOW });
    expect(state.pins).toEqual(current.pins);
    expect(state.platformJobs).toEqual(current.platformJobs);
  });
});
