/**
 * ai-providers dispatch — wire-shape proofs (2026-05-29 audit §3/§5).
 *
 * Pins the two provider-contract fixes:
 *   - Temperature parity: ALL three providers send an explicit
 *     temperature (was Google-only; Anthropic + OpenAI fell through to
 *     ~1.0).
 *   - gpt-5 / reasoning-model contract: reasoning models use
 *     `max_completion_tokens` and OMIT temperature (sending `max_tokens`
 *     or a non-default temperature 400s on every call). Non-reasoning
 *     OpenAI models keep `max_tokens` + explicit temperature.
 *
 * `fetch` is mocked so no real provider call fires; we assert the exact
 * request body each branch builds.
 */
import { dispatchAi, isOpenAiReasoningModel } from './ai-providers';

const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;

function okJson(body: any) {
  return { ok: true, status: 200, json: async () => body };
}

describe('isOpenAiReasoningModel', () => {
  it('recognizes gpt-5 family + o-series as reasoning models', () => {
    expect(isOpenAiReasoningModel('gpt-5')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-5-mini')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-5.1')).toBe(true);
    expect(isOpenAiReasoningModel('o1')).toBe(true);
    expect(isOpenAiReasoningModel('o3-mini')).toBe(true);
    expect(isOpenAiReasoningModel('o4')).toBe(true);
  });
  it('does NOT flag gpt-4 family / gpt-3.5 / empty', () => {
    expect(isOpenAiReasoningModel('gpt-4o-mini')).toBe(false);
    expect(isOpenAiReasoningModel('gpt-4.1')).toBe(false);
    expect(isOpenAiReasoningModel('gpt-3.5-turbo')).toBe(false);
    expect(isOpenAiReasoningModel('')).toBe(false);
    expect(isOpenAiReasoningModel(null)).toBe(false);
    expect(isOpenAiReasoningModel(undefined)).toBe(false);
  });
});

describe('dispatchAi — temperature parity', () => {
  beforeEach(() => fetchMock.mockReset());

  it('Anthropic sends an explicit temperature (0.7)', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ text: 'hi' }] }));
    await dispatchAi('anthropic', {
      apiKey: 'sk-ant-x', model: 'claude-3-5-haiku-20241022',
      system: 's', userPrompt: 'u', maxTokens: 300,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(300);
  });

  it('OpenAI (non-reasoning) sends max_tokens + explicit temperature', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }] }));
    await dispatchAi('openai', {
      apiKey: 'sk-x', model: 'gpt-4o-mini',
      system: 's', userPrompt: 'u', maxTokens: 300,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(300);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.temperature).toBe(0.7);
  });

  it('Google sends an explicit temperature (0.7)', async () => {
    fetchMock.mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    await dispatchAi('google', {
      apiKey: 'AIzaX', model: 'gemini-2.5-flash',
      system: 's', userPrompt: 'u', maxTokens: 300,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0.7);
    expect(body.generationConfig.maxOutputTokens).toBe(300);
  });
});

describe('dispatchAi — OpenAI reasoning-model contract (gpt-5 fix)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('gpt-5 uses max_completion_tokens (+reasoning headroom) and OMITS max_tokens + temperature', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }] }));
    await dispatchAi('openai', {
      apiKey: 'sk-x', model: 'gpt-5',
      system: 's', userPrompt: 'u', maxTokens: 1500,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // 2026-06-28 empty-reply fix — a reasoning model's internal reasoning tokens
    // count against max_completion_tokens, so the budget is the caller's VISIBLE
    // size (1500) PLUS a 12k reasoning allowance, else GPT-5 returns empty text.
    expect(body.max_completion_tokens).toBe(1500 + 12000);
    // …and reasoning_effort is pinned low (signage copy needs no deep reasoning).
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_tokens).toBeUndefined();
    // Reasoning models reject a non-default temperature → must be omitted.
    expect(body.temperature).toBeUndefined();
    expect(body.model).toBe('gpt-5');
  });
});
