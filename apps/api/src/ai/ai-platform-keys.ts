/**
 * OUR provider keys ("the platform key"), per vendor (2026-09-22).
 *
 * Until today our key was Anthropic only. Template design now prefers OpenAI (GPT-6 Sol), so our key
 * can be one of several — each read from its own env var, and a vendor with no key is simply not a
 * route (ai-model-catalog.ts `routeForJob` skips it). This file is the ONLY reader of these vars, so
 * no caller can hand one vendor's key to another vendor's endpoint.
 *
 *   anthropic → ANTHROPIC_API_KEY
 *   openai    → OPENAI_API_KEY
 *   google    → GEMINI_API_KEY (or GOOGLE_AI_API_KEY)
 */
import type { AiProvider } from './ai-providers';

export function platformKeyFor(provider: AiProvider): string | null {
  const raw =
    provider === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY
      : provider === 'openai'
        ? process.env.OPENAI_API_KEY
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key ? key : null;
}

export function hasPlatformKey(provider: AiProvider): boolean {
  return platformKeyFor(provider) !== null;
}

/** Which vendors we hold a key for — booleans only; a key value never leaves this module. */
export function platformKeysPresent(): Record<AiProvider, boolean> {
  return {
    anthropic: hasPlatformKey('anthropic'),
    openai: hasPlatformKey('openai'),
    google: hasPlatformKey('google'),
  };
}

/** Is ANY platform key configured (i.e. can a tenant without its own key use AI at all)? */
export function anyPlatformKey(): boolean {
  const p = platformKeysPresent();
  return p.anthropic || p.openai || p.google;
}

/**
 * The vendor our key reads IMAGES on (alt text, "Upload a look", menu photos): OpenAI first — its
 * Standard-tier vision model is the cheapest caption — then Anthropic. No Google platform vision
 * (Google vision is own-key only). One answer shared by the caller and by Super Admin's display.
 */
export function platformVisionProvider(): 'openai' | 'anthropic' | null {
  if (hasPlatformKey('openai')) return 'openai';
  if (hasPlatformKey('anthropic')) return 'anthropic';
  return null;
}
