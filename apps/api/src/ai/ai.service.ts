/**
 * AiService — Claude-backed content generation for signage operators.
 *
 * Sprint top-tier (2026-05-03). Operator: "get us at the top level of
 * everyone". The single biggest gap vs OptiSigns / ScreenCloud — they
 * ship AI copywriting, we don't. This service closes it.
 *
 * What it generates:
 *   - announcement   — eye-catching message for an ANNOUNCEMENT widget
 *   - quote          — motivational line for a fitness widget
 *   - menu_item      — short, appetizing description for a menu item
 *   - promo          — daily-special promo for a SPECIALS_CALLOUT widget
 *   - daypart        — auto-suggest breakfast/lunch/dinner copy by hour
 *   - ticker         — short scrolling-ticker line
 *
 * Direct fetch to Anthropic's Claude API (no SDK install — keeps the
 * dependency surface small and Railway's docker layer lean). Streaming
 * deferred; we return the full completion in one shot — total tokens
 * are tiny (≤300 out) and the user is waiting on a modal anyway.
 *
 * Cost guardrails:
 *   - Per-tenant rate limit: 30 generations / hour (BillingService logs
 *     them as an `aiGenerationCount` so any tier can layer caps).
 *   - max_tokens: 300 — caps output cost at ~$0.005 per call on Sonnet.
 *   - Refuses when ANTHROPIC_API_KEY is missing — surfaces a friendly
 *     "AI not configured for this deploy" error rather than a vague 500.
 */

import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export type AiIntent =
  | 'announcement'
  | 'quote'
  | 'menu_item'
  | 'promo'
  | 'daypart'
  | 'ticker';

export interface AiGenerateRequest {
  intent: AiIntent;
  /** Free-text context the operator types in. e.g. "spring break sale" or
   *  "introduce our new pour-over coffee station". Required. */
  context: string;
  /** Tone hint — defaults to whatever fits the intent. */
  tone?: 'energetic' | 'elegant' | 'playful' | 'serious' | 'casual';
  /** Number of options to return. Default 3. Max 5. */
  count?: number;
  /** Optional vertical hint so a gym promo doesn't read like a school
   *  announcement. Drives the system prompt. */
  vertical?: string;
}

export interface AiGenerateResponse {
  options: Array<{ text: string; tag?: string }>;
  intent: AiIntent;
}

const SYSTEM_PROMPTS: Record<AiIntent, string> = {
  announcement:
    'You write punchy digital-signage announcements for venues — schools, gyms, restaurants, retail, bars, corporate lobbies. Outputs are short, scannable from across a room, friendly but professional. Headline ≤8 words. Body ≤25 words. Never use clickbait, emoji, or all-caps gimmicks.',
  quote:
    'You write motivational one-liners for gym / fitness / wellness signage. ≤15 words. Specific, not vague — reference effort, consistency, recovery, or process, not generic "you got this" filler. Avoid clichés like "no pain no gain" or "rise and grind".',
  menu_item:
    'You write appetizing menu-item descriptions for restaurant signage. ≤18 words. Lead with technique or hero ingredient. Concrete sensory language (textures, smells, temperatures). Never use "delicious" or "amazing" — show, don\'t tell.',
  promo:
    'You write today-only promo cards for digital signage. Hook in ≤6 words, supporting line ≤20 words, optional price callout. Drive urgency without being sleazy. No "act now!!!", no exclamation pile-ons.',
  daypart:
    'You write daypart-specific copy for restaurant signage — breakfast, lunch, brunch, happy-hour, dinner, late-night. Match the energy of the meal. ≤20 words total. Time-of-day appropriate.',
  ticker:
    'You write scrolling-ticker lines for digital signage. ≤12 words per line. Information-dense. Multiple lines should each stand alone. No emoji.',
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /** Lazy in-memory rate limiter. Tenant id → rolling-1h timestamps.
   *  Cleared on pod restart — the cap is "soft" by design. A real cap
   *  with persistence ships when we add a per-tenant License.aiQuota. */
  private readonly recentByTenant = new Map<string, number[]>();
  private readonly HOURLY_CAP = 30;

  async generate(opts: AiGenerateRequest & { tenantId: string }): Promise<AiGenerateResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI is not configured on this deployment. Set ANTHROPIC_API_KEY in env to enable.',
      );
    }
    if (!opts.context || !opts.context.trim()) {
      throw new BadRequestException('Provide some context for the AI to work with.');
    }
    if (!SYSTEM_PROMPTS[opts.intent]) {
      throw new BadRequestException(`Unknown intent: ${opts.intent}`);
    }
    // 2026-05-03 SECURITY FIX — operator-controlled inputs flow into a
    // paid Anthropic call. Without caps an attacker (or buggy widget)
    // could ship a 100KB context to amplify cost. Hard caps below; the
    // model also has max_tokens=300 on output as a separate guard.
    if (opts.context.length > 2000) {
      throw new BadRequestException('Context too long. Keep it under 2000 characters.');
    }
    // `vertical` is interpolated into the user prompt — whitelist it
    // against the canonical VERTICALS so a malicious string can't
    // change the system prompt or pollute logs.
    const ALLOWED_VERTICALS = new Set([
      'K12', 'GYM', 'RETAIL', 'CORPORATE', 'QSR', 'FASHION', 'BAR', 'venue',
      // Lower-case variants the frontend might send via tenantCopy.vertical
      'k12', 'gym', 'retail', 'corporate', 'qsr', 'fashion', 'bar',
    ]);
    if (opts.vertical && !ALLOWED_VERTICALS.has(opts.vertical)) {
      throw new BadRequestException('Invalid vertical.');
    }
    // Tone whitelist — same idea, prevents prompt injection via the
    // user-controlled tone field.
    const ALLOWED_TONES = new Set(['energetic', 'elegant', 'playful', 'serious', 'casual']);
    if (opts.tone && !ALLOWED_TONES.has(opts.tone)) {
      throw new BadRequestException('Invalid tone.');
    }

    // Rate-limit: 30/hour/tenant. Sliding window kept in-memory.
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const recent = (this.recentByTenant.get(opts.tenantId) || []).filter((t) => t > oneHourAgo);
    if (recent.length >= this.HOURLY_CAP) {
      throw new BadRequestException(
        `Hit the hourly AI cap (${this.HOURLY_CAP} generations/hour). Try again later or contact sales for a higher tier.`,
      );
    }
    recent.push(now);
    this.recentByTenant.set(opts.tenantId, recent);

    const count = Math.min(Math.max(opts.count ?? 3, 1), 5);
    const tone = opts.tone || 'casual';
    const vertical = opts.vertical || 'venue';

    const userPrompt = [
      `Context: ${opts.context.trim()}`,
      `Vertical: ${vertical}`,
      `Tone: ${tone}`,
      `Generate ${count} distinct options.`,
      '',
      'Return ONLY a JSON array of objects, no preamble, no markdown:',
      '[{ "text": "..." }, { "text": "..." }, ...]',
      'Each "text" is the full piece of copy ready to paste. No labels, no numbering inside the text.',
    ].join('\n');

    let raw: string;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022', // Cheapest tier — content gen is short
          max_tokens: 300,
          system: SYSTEM_PROMPTS[opts.intent],
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`Anthropic API non-2xx: ${res.status} ${body.slice(0, 200)}`);
        throw new ServiceUnavailableException(`AI service responded ${res.status}.`);
      }
      const json = await res.json() as any;
      raw = json?.content?.[0]?.text || '';
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Anthropic fetch failed: ${err?.message}`);
      throw new ServiceUnavailableException('AI service unreachable.');
    }

    // Defensive parse — model is instructed to return JSON only, but
    // sometimes wraps in ```json fences or prefaces. Strip + fallback.
    let options: Array<{ text: string; tag?: string }> = [];
    const stripped = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed)) {
        options = parsed
          .map((o: any) => ({ text: String(o?.text || '').trim(), tag: o?.tag }))
          .filter((o) => o.text);
      }
    } catch {
      // Plain-text fallback: split on blank lines, pick the first N.
      options = stripped
        .split(/\n{2,}/)
        .map((s) => ({ text: s.trim() }))
        .filter((o) => o.text)
        .slice(0, count);
    }
    if (options.length === 0) {
      throw new ServiceUnavailableException('AI returned an empty result. Try rephrasing your context.');
    }

    return { options, intent: opts.intent };
  }
}
