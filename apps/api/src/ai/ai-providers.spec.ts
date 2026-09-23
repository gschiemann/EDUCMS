/**
 * ai-providers dispatch — wire-shape proofs.
 *
 * 2026-09-22: request rules come from the model CATALOG's capabilities, not from id patterns.
 * These pin, per model class, the exact body each provider receives:
 *   - models that take a temperature get the parity 0.7; models that reject one get none
 *     (Claude 5, every OpenAI reasoning model, Gemini 3);
 *   - the effort knob in each vendor's own words (`output_config.effort`, `reasoning_effort`,
 *     `thinkingConfig.thinkingLevel`) at the job's level, only where the model has one;
 *   - reasoning headroom on the output ceiling for every model that thinks (the 2026-06-28
 *     empty-reply incident), none for models that don't;
 *   - the answer read by content-block TYPE (Claude 5 replies lead with thinking blocks);
 *   - usage reported for the ledger;
 *   - self-correction: a 400 that names a parameter we sent is retried once without it and the
 *     lesson is kept; a refused model is retried once on the verified fallback.
 *
 * `fetch` is mocked so no real provider call fires.
 */
import {
  dispatchAi,
  dispatchAiMessages,
  isOpenAiReasoningModel,
  requestParamsFor,
  textFromResponse,
  usageFromResponse,
  aiProvidersForUi,
  defaultModelFor,
  healLegacyModelId,
  isKnownModel,
  visionModelFor,
} from './ai-providers';
import { getCatalog, learnCapability, setCatalogState } from './ai-model-catalog';

const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;

function okJson(body: any) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function errJson(status: number, body: string) {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}
function sentBody(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  fetchMock.mockReset();
  setCatalogState({});
});

describe('isOpenAiReasoningModel', () => {
  it('answers from the catalog for known models', () => {
    expect(isOpenAiReasoningModel('gpt-5.6-sol')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-5.6-luna')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-6-astra')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-4o-mini')).toBe(false);
  });
  it('treats an UNKNOWN id as reasoning unless it is plainly gpt-3/gpt-4 (the conservative contract never 400s)', () => {
    expect(isOpenAiReasoningModel('gpt-5')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-7-nova')).toBe(true);
    expect(isOpenAiReasoningModel('o3-mini')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-4.1')).toBe(false);
    expect(isOpenAiReasoningModel('gpt-3.5-turbo')).toBe(false);
    expect(isOpenAiReasoningModel('')).toBe(false);
    expect(isOpenAiReasoningModel(null)).toBe(false);
    expect(isOpenAiReasoningModel(undefined)).toBe(false);
  });
});

describe('dispatchAi — Anthropic', () => {
  it('Haiku 4.5 (no effort knob, no thinking): temperature 0.7, visible max_tokens, no output_config', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 2 } }));
    const out = await dispatchAi('anthropic', {
      apiKey: 'sk-ant-x', model: 'claude-haiku-4-5', system: 's', userPrompt: 'u', maxTokens: 300,
    });
    const body = sentBody();
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(300);
    expect(body.output_config).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(out.raw).toBe('hi');
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
  });

  it('Claude 5 (Sonnet 5 / Opus 5.5): NO temperature, output_config.effort at the job level, reasoning headroom, never a `thinking` field', async () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5-5']) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(okJson({ content: [{ type: 'text', text: 'ok' }] }));
      await dispatchAi('anthropic', { apiKey: 'sk-ant-x', model, job: 'design', system: 's', userPrompt: 'u', maxTokens: 16000 });
      const body = sentBody();
      expect(body.model).toBe(model);
      expect(body.temperature).toBeUndefined();
      // design runs at the MID effort level (Greg, 2026-09-22), with headroom sized to it
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body.thinking).toBeUndefined();
      expect(body.max_tokens).toBe(16000 + 24000);
    }
  });

  it('GPT-6 Sol designs at the MID effort level with room for its thinking; fast jobs stay low', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: '<!doctype html><html></html>' } }] }));
    await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', job: 'design', system: 's', userPrompt: 'u', maxTokens: 16000 });
    expect(sentBody()).toMatchObject({ model: 'gpt-6-sol', reasoning_effort: 'medium', max_completion_tokens: 16000 + 24000 });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }] }));
    await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-luna', job: 'fast', system: 's', userPrompt: 'u', maxTokens: 500 });
    expect(sentBody()).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'low', max_completion_tokens: 500 + 12000 });
  });

  it('reads the answer by block TYPE — a Claude 5 reply that starts with a thinking block still returns its text', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '<html>board</html>' },
        ],
        usage: { input_tokens: 5000, output_tokens: 7000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
      }),
    );
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.raw).toBe('<html>board</html>');
    expect(out.usage).toEqual({ inputTokens: 5000, outputTokens: 7000, cacheReadTokens: 4000, cacheWriteTokens: 0 });
  });

  it('a refusal comes back as an error envelope (not a silent empty string)', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'refusal' }));
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.errorStatus).toBe(502);
    expect(out.errorBody).toMatch(/refusal/);
    expect(out.refusal).toBe(true);
  });

  it('an empty answer that is NOT a refusal (budget spent) is an error envelope without the refusal flag', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }));
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.errorStatus).toBe(502);
    expect(out.refusal).toBeUndefined();
  });

  it('system rides the block-array form with ephemeral cache_control (the ~90% repeat-call discount)', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ type: 'text', text: 'hi' }] }));
    await dispatchAi('anthropic', {
      apiKey: 'sk-ant-x', model: 'claude-haiku-4-5', system: 'a large static designer prompt', userPrompt: 'u', maxTokens: 300,
    });
    const body = sentBody();
    // A refactor that silently reverts to the plain-string `system` form drops the cache marker
    // with zero behavior change in tests — this pin is what makes that regression visible.
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0]).toMatchObject({ type: 'text', text: 'a large static designer prompt', cache_control: { type: 'ephemeral' } });
    expect(body.messages[0]).toMatchObject({ role: 'user', content: 'u' });
  });
});

describe('dispatchAi — OpenAI', () => {
  it('gpt-4o-mini (no reasoning): max_completion_tokens = visible, temperature 0.7, no reasoning_effort', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-4o-mini', system: 's', userPrompt: 'u', maxTokens: 300 });
    const body = sentBody();
    expect(body.max_completion_tokens).toBe(300);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBe(0.7);
    expect(body.reasoning_effort).toBeUndefined();
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('reasoning models (luna / sol / astra): headroom on max_completion_tokens, reasoning_effort low, NO temperature', async () => {
    for (const model of ['gpt-6-luna', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-6-astra']) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }] }));
      await dispatchAi('openai', { apiKey: 'sk-x', model, system: 's', userPrompt: 'u', maxTokens: 1500 });
      const body = sentBody();
      expect(body.model).toBe(model);
      expect(body.max_completion_tokens).toBe(1500 + 12000);
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_tokens).toBeUndefined();
      expect(body.temperature).toBeUndefined();
    }
  });

  it('an OpenAI REFUSAL (content null + message.refusal) is an error envelope flagged as a refusal, never a silent ""', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: null, refusal: 'I can not help with that.' }, finish_reason: 'stop' }] }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(out).toMatchObject({ raw: '', errorStatus: 502, refusal: true });
    expect(out.errorBody).toMatch(/declined/);
  });

  it('an OpenAI reply with no text because the budget ran out is an error envelope (so failover can act), not a refusal', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 50, completion_tokens: 12300 } }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(out).toMatchObject({ raw: '', errorStatus: 502 });
    expect(out.refusal).toBeUndefined();
    expect(out.errorBody).toMatch(/finish_reason=length/);
    expect(out.usage).toEqual({ inputTokens: 50, outputTokens: 12300 }); // the spent budget is still metered
  });

  it('no Anthropic cache_control leaks into the OpenAI body', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'hi' } }] }));
    await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-4o-mini', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(JSON.stringify(sentBody())).not.toContain('cache_control');
  });
});

describe('dispatchAi — Google', () => {
  it('Gemini 3: NO temperature (Google guidance), thinkingConfig.thinkingLevel, headroom on maxOutputTokens; key in the header', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, thoughtsTokenCount: 20 },
      }),
    );
    const out = await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.8-flash', system: 's', userPrompt: 'u', maxTokens: 300 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain('AIzaX');
    expect(init.headers['x-goog-api-key']).toBe('AIzaX');
    const body = sentBody();
    expect(body.generationConfig.temperature).toBeUndefined();
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(body.generationConfig.maxOutputTokens).toBe(300 + 12000);
    // thinking tokens bill as output
    expect(out.usage).toEqual({ inputTokens: 9, outputTokens: 24 });
  });

  it('a Gemini SAFETY stop or a blocked prompt is a refusal; running out of budget is not', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }));
    const safety = await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.8-flash', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(safety).toMatchObject({ errorStatus: 502, refusal: true });
    fetchMock.mockResolvedValueOnce(okJson({ promptFeedback: { blockReason: 'OTHER' } }));
    const blocked = await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.8-flash', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(blocked).toMatchObject({ errorStatus: 502, refusal: true });
    fetchMock.mockResolvedValueOnce(okJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }));
    const budget = await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.8-flash', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(budget.errorStatus).toBe(502);
    expect(budget.refusal).toBeUndefined();
  });

  it('a saved gemini-2.5 model is never sent — it is not in the catalog, so the Standard tier answers', async () => {
    fetchMock.mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-2.5-flash', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(fetchMock.mock.calls[0][0]).toContain(`/models/${defaultModelFor('google')}:generateContent`);
    expect(fetchMock.mock.calls[0][0]).not.toContain('2.5');
  });
});

describe('dispatch — self-correction', () => {
  it('a 400 that names `temperature` is retried once WITHOUT it, and the lesson sticks for the next call', async () => {
    fetchMock
      .mockResolvedValueOnce(errJson(400, '{"error":{"message":"temperature is not supported with this model"}}'))
      .mockResolvedValueOnce(okJson({ content: [{ type: 'text', text: 'ok' }] }))
      .mockResolvedValueOnce(okJson({ content: [{ type: 'text', text: 'ok' }] }));
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-haiku-4-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.errorStatus).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).temperature).toBe(0.7);
    expect(sentBody(1).temperature).toBeUndefined();
    expect(getCatalog().get('anthropic', 'claude-haiku-4-5')!.caps.temperature).toBe(false);
    await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-haiku-4-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(sentBody(2).temperature).toBeUndefined();
  });

  it('a 400 about the effort knob is retried once without it', async () => {
    fetchMock
      .mockResolvedValueOnce(errJson(400, '{"error":{"message":"Unsupported parameter: reasoning_effort"}}'))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'ok' } }] }));
    const out = await dispatchAi('openai', { apiKey: 'k', model: 'gpt-5.6-sol', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.raw).toBe('ok');
    expect(sentBody(0).reasoning_effort).toBe('low');
    expect(sentBody(1).reasoning_effort).toBeUndefined();
  });

  it('a 400 that is NOT about a parameter we sent is returned as-is (no blind retry)', async () => {
    fetchMock.mockResolvedValue(errJson(400, '{"error":{"message":"prompt is too long"}}'));
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-sonnet-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.errorStatus).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a REFUSED model (404) is retried once on the verified fallback and reported', async () => {
    fetchMock
      .mockResolvedValueOnce(errJson(404, '{"error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}'))
      .mockResolvedValueOnce(okJson({ content: [{ type: 'text', text: 'ok' }] }));
    const out = await dispatchAi('anthropic', {
      apiKey: 'k', model: 'claude-opus-5-5', fallbackModel: 'claude-sonnet-5', system: 's', userPrompt: 'u', maxTokens: 100,
    });
    expect(out.raw).toBe('ok');
    expect(out.model).toBe('claude-sonnet-5');
    expect(out.failedModel).toBe('claude-opus-5-5');
    expect(sentBody(1).model).toBe('claude-sonnet-5');
  });

  it('without a fallback, a refused model is returned as the error (never a silent substitute)', async () => {
    fetchMock.mockResolvedValue(errJson(404, 'model not found'));
    const out = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 100 });
    expect(out.errorStatus).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchAiMessages — multi-turn', () => {
  it('maps assistant turns to Gemini `model` role and keeps the conversation order', async () => {
    fetchMock.mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }));
    await dispatchAiMessages('google', {
      apiKey: 'AIzaX',
      model: 'gemini-3.8-flash',
      system: 's',
      maxTokens: 100,
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    expect(sentBody().contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
  });
  it('refuses an empty conversation without calling the provider', async () => {
    const out = await dispatchAiMessages('anthropic', { apiKey: 'k', system: 's', maxTokens: 10, messages: [] });
    expect(out.errorStatus).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 2026-09-23 — a draft cut off at the output ceiling is SAID so, even when it has text ──────
// The reply shapes are the vendors' own (the same shapes every test above uses); only the stop
// field differs. Before this, only an EMPTY cut-off reply was caught — half an HTML board with a
// finish_reason of `length` passed as a finished answer.
describe('dispatch — `truncated` is reported per vendor, including when there IS text', () => {
  const HALF_BOARD = '<!doctype html><html><head><style>.stage{width:3840px;height:2160px}</style></head><body><div class="stage"><h1 data-field="headline">Burri';

  it('OpenAI: finish_reason=length with text → truncated, not an error; stop → not truncated', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: HALF_BOARD }, finish_reason: 'length' }], usage: { prompt_tokens: 50, completion_tokens: 40000 } }));
    const cut = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', job: 'design', system: 's', userPrompt: 'u', maxTokens: 16000 });
    expect(cut).toMatchObject({ raw: HALF_BOARD, truncated: true });
    expect(cut.errorStatus).toBeUndefined();
    fetchMock.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '<html></html>' }, finish_reason: 'stop' }] }));
    const whole = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(whole.truncated).toBe(false);
  });

  it('Anthropic: stop_reason=max_tokens with text → truncated; end_turn → not', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: HALF_BOARD }], stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 40000 } }));
    const cut = await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 16000 });
    expect(cut).toMatchObject({ raw: HALF_BOARD, truncated: true });
    fetchMock.mockResolvedValueOnce(okJson({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    expect((await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 's', userPrompt: 'u', maxTokens: 100 })).truncated).toBe(false);
  });

  it('Gemini: finishReason=MAX_TOKENS with text → truncated; STOP → not', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ candidates: [{ content: { parts: [{ text: HALF_BOARD }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } }));
    const cut = await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.1-pro-preview', system: 's', userPrompt: 'u', maxTokens: 16000 });
    expect(cut).toMatchObject({ raw: HALF_BOARD, truncated: true });
    fetchMock.mockResolvedValueOnce(okJson({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }));
    expect((await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.8-flash', system: 's', userPrompt: 'u', maxTokens: 300 })).truncated).toBe(false);
  });

  it('an EMPTY cut-off reply is still the error envelope it always was (so failover can act) — and says truncated', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(out).toMatchObject({ raw: '', errorStatus: 502, truncated: true });
  });

  it('an HTTP error is never "truncated"', async () => {
    fetchMock.mockResolvedValue(errJson(500, 'boom'));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 300 });
    expect(out).toMatchObject({ errorStatus: 500, truncated: false });
  });
});

// ── 2026-09-23 — images as each vendor's own image part (logo + photo on the draw, the screenshot
// on the critique). Text FIRST, then the images, on the last user turn — so the cached prefix is
// the same whether or not images follow.
describe('dispatch — images ride as real image parts, per vendor', () => {
  const LOGO = { mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==', detail: 'high' as const };
  const HERO = { mediaType: 'image/jpeg', base64: '/9j/4AAQSkZJRgABAQ==', detail: 'low' as const };

  it('OpenAI chat: content = [text, image_url(data URI, detail)…]', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', job: 'design', system: 'SYS', userPrompt: 'look at these', maxTokens: 600, images: [LOGO, HERO] });
    const body = sentBody();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look at these' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', detail: 'high' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==', detail: 'low' } },
      ],
    });
  });

  it('Anthropic: content = [text, image(base64 source)…]; the cached system block is untouched', async () => {
    fetchMock.mockResolvedValue(okJson({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    await dispatchAi('anthropic', { apiKey: 'k', model: 'claude-opus-5-5', system: 'SYS', userPrompt: 'look', maxTokens: 600, images: [LOGO] });
    const body = sentBody();
    expect(body.system[0]).toMatchObject({ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } },
        ],
      },
    ]);
  });

  it('Gemini: parts = [text, inlineData{mimeType,data}…]', async () => {
    fetchMock.mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }));
    await dispatchAi('google', { apiKey: 'AIzaX', model: 'gemini-3.1-pro-preview', system: 'SYS', userPrompt: 'look', maxTokens: 600, images: [HERO] });
    expect(sentBody().contents).toEqual([
      { role: 'user', parts: [{ text: 'look' }, { inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==' } }] },
    ]);
  });

  it('multi-turn: the images ride on the LAST user turn only', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'ok' } }] }));
    await dispatchAiMessages('openai', {
      apiKey: 'sk-x',
      model: 'gpt-6-sol',
      system: 's',
      maxTokens: 100,
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
      images: [HERO],
    });
    const msgs = sentBody().messages;
    expect(msgs[1]).toEqual({ role: 'user', content: 'a' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'b' });
    expect(msgs[3].content[0]).toEqual({ type: 'text', text: 'c' });
    expect(msgs[3].content[1].type).toBe('image_url');
  });

  it('no images → the plain string content every call has always sent (byte-identical body)', async () => {
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'ok' } }] }));
    await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 100, images: [] });
    expect(sentBody().messages[1]).toEqual({ role: 'user', content: 'u' });
  });

  it('a model the catalog says cannot see images never gets them — and the output says they were dropped', async () => {
    learnCapability('openai', 'gpt-4o-mini', { vision: false });
    fetchMock.mockResolvedValue(okJson({ choices: [{ message: { content: 'ok' } }] }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-4o-mini', system: 's', userPrompt: 'u', maxTokens: 100, images: [LOGO] });
    expect(sentBody().messages[1]).toEqual({ role: 'user', content: 'u' });
    expect(out.imagesDropped).toBe(true);
  });

  it('a 400 that refuses the image is retried ONCE without it — the prompt still gets its answer', async () => {
    fetchMock
      .mockResolvedValueOnce(errJson(400, '{"error":{"message":"Invalid content type. image_url is only supported by certain models."}}'))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: 'ok' } }] }));
    const out = await dispatchAi('openai', { apiKey: 'sk-x', model: 'gpt-6-sol', system: 's', userPrompt: 'u', maxTokens: 100, images: [LOGO] });
    expect(out.raw).toBe('ok');
    expect(out.imagesDropped).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Array.isArray(sentBody(0).messages[1].content)).toBe(true);
    expect(sentBody(1).messages[1]).toEqual({ role: 'user', content: 'u' });
  });
});

describe('catalog-facing helpers', () => {
  it('the settings picker shows 3 tiers per provider, each the model serving it today', () => {
    const ui = aiProvidersForUi();
    expect(ui.map((p) => p.id)).toEqual(['anthropic', 'openai', 'google']);
    const anthropic = ui[0];
    expect(anthropic.models.map((m) => m.tier)).toEqual(['standard', 'balanced', 'premium']);
    expect(anthropic.models.map((m) => m.id)).toEqual(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5-5']);
    expect(anthropic.models[2].label).toBe('Premium — Claude Opus 5.5');
    expect(anthropic.models[0].default).toBe(true);
    expect(ui[1].models.map((m) => m.id)).toEqual(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-6-sol']);
    expect(ui[2].models.map((m) => m.id)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview']);
  });

  it('a saved choice heals to the tier it came from — and a tier key resolves to that tier', () => {
    expect(healLegacyModelId('openai', 'gpt-5')).toBe('gpt-6-sol');
    expect(healLegacyModelId('openai', 'gpt-4o-mini')).toBe('gpt-6-luna');
    expect(healLegacyModelId('anthropic', 'claude-opus-4-6')).toBe('claude-opus-5-5');
    expect(healLegacyModelId('anthropic', 'claude-3-5-haiku-20241022')).toBe('claude-haiku-4-5');
    expect(healLegacyModelId('google', 'gemini-2.5-flash')).toBe('gemini-3.5-flash-lite');
    expect(healLegacyModelId('google', 'gemini-2.5-pro')).toBe('gemini-3.1-pro-preview');
    expect(healLegacyModelId('anthropic', 'premium')).toBe('claude-opus-5-5');
    expect(healLegacyModelId('anthropic', 'nonsense-model')).toBe('claude-haiku-4-5');
    expect(healLegacyModelId('anthropic', null)).toBe('claude-haiku-4-5');
  });

  it('isKnownModel accepts tier keys and sendable catalog ids, refuses free text', () => {
    expect(isKnownModel('anthropic', 'premium')).toBe(true);
    expect(isKnownModel('anthropic', 'claude-sonnet-5')).toBe(true);
    expect(isKnownModel('anthropic', 'claude-opus-99')).toBe(false);
    expect(isKnownModel('google', 'gemini-2.5-flash')).toBe(false);
  });

  it('requestParamsFor gives a vision caller the same rules as the dispatcher', () => {
    expect(requestParamsFor('openai', 'gpt-4o-mini', 300)).toEqual({ max_completion_tokens: 300, temperature: 0.7 });
    expect(requestParamsFor('openai', 'gpt-5.6-luna', 300)).toEqual({ max_completion_tokens: 12300, reasoning_effort: 'low' });
    expect(requestParamsFor('anthropic', 'claude-haiku-4-5', 300)).toEqual({ max_tokens: 300, temperature: 0.7 });
    expect(requestParamsFor('anthropic', 'claude-sonnet-5', 300)).toEqual({ max_tokens: 12300, output_config: { effort: 'low' } });
    expect(requestParamsFor('google', 'gemini-3.5-flash-lite', 300)).toEqual({
      generationConfig: { maxOutputTokens: 12300, thinkingConfig: { thinkingLevel: 'low' } },
    });
    // An id nobody verified gets the conservative shape: nothing optional, headroom kept.
    expect(requestParamsFor('anthropic', 'claude-mystery-9', 300)).toEqual({ max_tokens: 12300 });
  });

  it('text + usage parsers read every vendor shape', () => {
    expect(textFromResponse('anthropic', { content: [{ type: 'thinking' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
    expect(textFromResponse('openai', { choices: [{ message: { content: 'x' } }] })).toBe('x');
    expect(textFromResponse('google', { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'y' }] } }] })).toBe('y');
    expect(usageFromResponse('openai', {})).toEqual({ inputTokens: 0, outputTokens: 0 });
    // OpenAI cached prompt tokens are split out so they bill at the cached rate (a tenth of input)
    expect(
      usageFromResponse('openai', { usage: { prompt_tokens: 10_000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 8_000 } } }),
    ).toEqual({ inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 8_000 });
    // …and cache WRITES (GPT-5.6+ bill them at 1.25x): every prompt token lands in exactly one bucket
    expect(
      usageFromResponse('openai', {
        usage: { prompt_tokens: 10_000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 6_000, cache_write_tokens: 3_000 } },
      }),
    ).toEqual({ inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 6_000, cacheWriteTokens: 3_000 });
  });

  it('vision runs on the Standard tier for every vendor', () => {
    expect(visionModelFor('anthropic')).toBe('claude-haiku-4-5');
    expect(visionModelFor('openai')).toBe('gpt-6-luna');
    expect(visionModelFor('google')).toBe('gemini-3.5-flash-lite');
  });
});
