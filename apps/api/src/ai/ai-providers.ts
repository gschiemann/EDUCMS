/**
 * AI provider adapters — translate our internal {system, userPrompt}
 * shape into the wire format each provider expects.
 *
 * Adding a new provider here is 3 things:
 *   1) Add the literal to AiProvider union below
 *   2) Add a case to dispatchAi() with its model name + endpoint
 *   3) Add the validation regex to validateApiKeyShape()
 *
 * 2026-05-04 BYOK pivot — operators can supply their own keys so cost
 * shifts to them. We still default to Anthropic with our platform key
 * for the trial-mode tenants who haven't configured BYOK yet.
 */

export type AiProvider = 'anthropic' | 'openai';

/** Normalize user input — accept "Anthropic" / "claude" etc. */
export function coerceProvider(s: string | null | undefined): AiProvider | null {
  if (!s) return null;
  const lc = String(s).trim().toLowerCase();
  if (['anthropic', 'claude'].includes(lc)) return 'anthropic';
  if (['openai', 'gpt', 'gpt-4', 'chatgpt'].includes(lc)) return 'openai';
  return null;
}

/**
 * Sanity check the shape of a provider key BEFORE we send it. This is
 * a UX guardrail — catches "you pasted the wrong thing" early without
 * burning a real API call. The provider validates for real on the
 * test request after.
 */
export function validateApiKeyShape(provider: AiProvider, key: string): string | null {
  const trimmed = (key || '').trim();
  if (!trimmed) return 'API key is required.';
  if (trimmed.length < 16) return 'API key looks too short.';
  if (trimmed.length > 256) return 'API key looks too long.';
  if (provider === 'anthropic') {
    if (!trimmed.startsWith('sk-ant-')) {
      return 'Anthropic keys start with "sk-ant-". Double-check you copied the right one.';
    }
  } else if (provider === 'openai') {
    if (!trimmed.startsWith('sk-')) {
      return 'OpenAI keys start with "sk-". Double-check you copied the right one.';
    }
  }
  return null;
}

interface DispatchInput {
  apiKey: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
}

interface DispatchOutput {
  raw: string;
  /** Provider-reported errors map to ServiceUnavailableException upstream. */
  errorStatus?: number;
  errorBody?: string;
}

/**
 * Single entrypoint for both providers. Caller passes the system +
 * user prompts; we shape them appropriately and return the raw text
 * response. Caller does the JSON parsing (it's the same on both ends
 * because our system prompts force JSON output).
 */
export async function dispatchAi(
  provider: AiProvider,
  input: DispatchInput,
): Promise<DispatchOutput> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.userPrompt }],
      }),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    return { raw: json?.content?.[0]?.text || '' };
  }

  if (provider === 'openai') {
    // gpt-4o-mini: cheapest tier with reasonable quality. Same cost
    // tier as claude-3-5-haiku within an order of magnitude. We use
    // chat completions (not the new /v1/responses) for max compat
    // with operators who configured a key on a non-current account.
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: input.maxTokens,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return { raw: '', errorStatus: res.status, errorBody };
    }
    const json = (await res.json()) as any;
    return { raw: json?.choices?.[0]?.message?.content || '' };
  }

  // Unreachable given coerceProvider() validates upstream, but keeps
  // the type-checker happy.
  return { raw: '', errorStatus: 400, errorBody: `Unsupported provider: ${provider}` };
}
