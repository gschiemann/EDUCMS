/**
 * Saved model choices → the TIER they meant (2026-09-22).
 *
 * `Tenant.aiModel` has held a concrete model id since BYOK shipped. A concrete id goes stale the
 * month its vendor ships a successor — the reason three generations of retired ids needed alias
 * maps (W0-03). The catalog now resolves TIERS, so a saved choice is read as the tier it was
 * picked from: an operator who chose "Premium — GPT-5" in June gets the current Premium model
 * today, and next quarter's, without anyone touching their settings.
 *
 * Nothing in this file is ever SENT to a provider — every id here is a KEY that maps forward.
 * `tools/check-model-retirements.cjs` skips this file for exactly that reason; a retired id
 * belongs HERE, and nowhere else in `src`.
 */
import type { AiProvider } from './ai-providers';
import { AI_TIERS, familyOf, getCatalog, type AiTier, type ResolvedCatalog } from './ai-model-catalog';

/** Every id an operator could have saved before tiers existed, and the tier it sat in. */
export const LEGACY_MODEL_TIERS: Record<AiProvider, Record<string, AiTier>> = {
  anthropic: {
    'claude-3-5-haiku-20241022': 'standard', // retired 2026-02-19
    'claude-3-5-sonnet-20241022': 'balanced', // retired 2025-10-28
    'claude-sonnet-4-5-20250929': 'balanced',
    'claude-sonnet-4-6': 'balanced',
    'claude-opus-4-20250514': 'premium',
    'claude-opus-4-1-20250805': 'premium', // retired 2026-08-05
    'claude-opus-4-6': 'premium',
  },
  openai: {
    'gpt-4o-mini': 'standard',
    'gpt-4.1': 'balanced',
    'gpt-5': 'premium', // provider-deprecated; its Premium slot is gpt-5.6-sol today
    'gpt-5-mini': 'standard',
  },
  google: {
    'gemini-1.5-flash': 'standard',
    'gemini-1.5-pro': 'premium',
    'gemini-2.0-flash': 'standard', // shut down 2026-06-01
    'gemini-2.5-flash': 'standard', // access-limited; shuts down 2026-10-16
    'gemini-2.5-pro': 'premium', // access-limited; shuts down 2026-10-16
    'gemini-3.5-flash': 'balanced',
  },
};

/**
 * Which tier a saved `Tenant.aiModel` value means. Accepts the new tier keys ('premium'), a legacy
 * id (the tier it was offered in), any id in a known family (the tier that family serves today),
 * or anything else (→ standard, the cheapest safe choice — same fall-through the old healer used).
 */
export function tierForSavedChoice(
  provider: AiProvider,
  saved: unknown,
  cat: ResolvedCatalog = getCatalog(),
): AiTier {
  if (typeof saved !== 'string' || !saved.trim()) return 'standard';
  const value = saved.trim();
  if ((AI_TIERS as readonly string[]).includes(value)) return value as AiTier;
  // The legacy map wins over the family match: it records the tier the id was actually OFFERED in
  // (gemini-2.5-flash was the Standard default, even though today's flash family is Balanced).
  const legacy = LEGACY_MODEL_TIERS[provider]?.[value];
  if (legacy) return legacy;
  const fam = familyOf(provider, value, cat.patterns);
  if (fam) {
    const tiers = cat.tierFamilies[provider];
    for (const tier of AI_TIERS) {
      if (tiers[tier] === fam.family) return tier;
    }
  }
  return 'standard';
}
