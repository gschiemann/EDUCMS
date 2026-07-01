/**
 * concierge-map — Integration Concierge → App Registry bridge.
 *
 * World-class build (2026-07-01, App Library Tier 2 "concierge auto-fill",
 * see docs/research/2026-06-30-app-library/20-WORLDCLASS-BUILD-PLAN.md).
 *
 * The backend's `/integrations/discover` + `/describe` live in a SEPARATE
 * id space (`youtube`, `twitch`, `instagram`, `google-calendar`, …) from
 * the App Registry (`youtube`, `twitch`, `instagram`, `calendar`, …) —
 * they were built independently for a different purpose (classifying
 * integration CATEGORIES, not App Library tiles). This file is the ONLY
 * place that bridges the two, so app-registry.ts stays free of any
 * backend-shape knowledge and the Concierge discovery service stays free
 * of any App Registry knowledge.
 *
 * Kept as its own file (not folded into app-registry.ts or
 * AppLibraryPanel.tsx) per the mission spec — the registry is meant to
 * stay a small, dependency-free data file.
 */

import { getApp, type AppCategory, type AppDefinition } from './app-registry';

/** Discovery-service `ownLinks` / `ProviderCandidate.id` key -> App
 *  Registry app id + which config-field the detected value should
 *  prefill. Only entries with a real App Registry tile are listed here —
 *  a discovery candidate with no match here is simply not offered as an
 *  App Library suggestion (it may still be a normal Concierge/Settings
 *  suggestion elsewhere in the app; out of scope for this map). */
export interface ConciergeAppMatch {
  appId: string;
  /** The AppConfigForm field key the detected value should prefill
   *  (passed as `initialValues` — same shape the paste-first detector
   *  already produces via `detectApp()`). */
  prefillKey: string;
}

export const CONCIERGE_TO_APP_MAP: Record<string, ConciergeAppMatch> = {
  youtube: { appId: 'youtube', prefillKey: 'url' },
  vimeo: { appId: 'vimeo', prefillKey: 'url' },
  twitch: { appId: 'twitch', prefillKey: 'channel' },
  instagram: { appId: 'instagram', prefillKey: 'url' },
  'facebook-page': { appId: 'facebook-page', prefillKey: 'url' },
  'google-slides': { appId: 'google-slides', prefillKey: 'url' },
  'google-sheets': { appId: 'google-sheets', prefillKey: 'url' },
  // The backend integration RULE id is 'google-calendar'; the App
  // Registry tile id is 'calendar' — same destination, different id
  // spaces, exactly the drift this map exists to bridge.
  'google-calendar': { appId: 'calendar', prefillKey: 'url' },
  calendar: { appId: 'calendar', prefillKey: 'url' },
  'news-rss': { appId: 'news-rss', prefillKey: 'feedUrl' },
};

/** Category hint for the "no matches yet, describe your business"
 *  fallback — used only for a friendlier one-line prompt, not for
 *  filtering (kept intentionally tiny). */
export const CONCIERGE_CATEGORY_TO_APP_CATEGORY: Partial<Record<string, AppCategory>> = {
  streaming: 'video',
  calendar: 'calendar',
  social: 'social',
};

/** One resolved "Suggested for you" tile: an App Registry app matched from
 *  a Concierge candidate, with the operator's own detected link ready to
 *  prefill the config form. Shared shape between the App Library panel
 *  (Tier 2) and the onboarding auto-fill step (task #265, 2026-07-01) —
 *  both consume the same discover/describe response and must resolve it
 *  identically. */
export interface SuggestedApp {
  app: AppDefinition;
  prefill: Record<string, string>;
}

/** Minimal shape of a discover/describe candidate this resolver needs —
 *  intentionally narrower than `ConciergeProviderCandidate` in use-api.ts
 *  so this file doesn't have to import that hook module (keeps
 *  concierge-map.ts dependency-free of the API-client layer). */
export interface ConciergeCandidateLike {
  id: string;
  detectedValue?: string;
}

/**
 * Resolve a discover/describe response's candidates + ownLinks into App
 * Registry tiles, via CONCIERGE_TO_APP_MAP. `detectedValue` (the operator's
 * ACTUAL link, from the backend's extractOwnLinks) wins over just knowing
 * the category exists — that's what lets a suggestion open pre-filled
 * instead of just naming an app the operator already knows.
 *
 * Pulled out of AppLibraryPanel.tsx (2026-07-01) so the onboarding
 * Concierge auto-fill step (#265) resolves suggestions IDENTICALLY to the
 * Apps panel instead of re-implementing the same matching logic twice.
 */
export function resolveConciergeSuggestions(
  candidates: ConciergeCandidateLike[],
  ownLinks: Record<string, string>,
  opts?: { limit?: number },
): SuggestedApp[] {
  const out: SuggestedApp[] = [];
  const seen = new Set<string>();
  const tryAdd = (key: string, value: string | undefined) => {
    const match = CONCIERGE_TO_APP_MAP[key];
    if (!match || seen.has(match.appId)) return;
    const app = getApp(match.appId);
    if (!app || app.comingSoon) return; // never suggest a dead-end tile
    seen.add(match.appId);
    out.push({ app, prefill: value ? { [match.prefillKey]: value } : {} });
  };
  // Own-links first (higher-value — carries a real detected value).
  for (const [key, value] of Object.entries(ownLinks)) tryAdd(key, value);
  // Then any candidate we haven't already matched via ownLinks, even
  // without a specific detected value (still worth surfacing — "we
  // noticed you might want Slides" beats not suggesting it at all).
  for (const c of candidates) tryAdd(c.id, c.detectedValue);
  return out.slice(0, opts?.limit ?? 4); // keep the row small — a pinned strip, not a second grid
}

// ─── Onboarding → Apps panel handoff (task #265, 2026-07-01) ──────────────
//
// The onboarding "Your apps, ready to go" step (apps/web/src/app/onboarding/
// apps/page.tsx) runs discover BEFORE the operator has ever opened a
// template's Apps panel. Rather than build new backend persistence for
// "apps the operator picked during onboarding," we reuse the exact pattern
// BrandingWizard already uses for its scan cache (a tenant-scoped
// localStorage key, see `scanCacheKey` in BrandingWizard.tsx) — the
// lightest honest mechanic that matches how onboarding already passes
// state to the rest of the app. AppLibraryPanel checks this cache BEFORE
// firing its own discover call, so:
//   1. the operator sees the row pre-warmed instantly (no re-fetch, no
//      flash of nothing) the first time they open any template's Apps tab
//   2. anything they already tapped "Add" on during onboarding is marked
//      picked so we don't re-suggest what they already own
// Cache is intentionally NOT the raw discover response — we store only the
// resolved (appId, prefill) pairs, which round-trip through JSON safely
// (an AppDefinition carries a `build` function and can't be serialized).
const ONBOARDING_HANDOFF_KEY_PREFIX = 'edu-cms-concierge-onboarding-v1';

export interface OnboardingConciergeSuggestion {
  appId: string;
  prefill: Record<string, string>;
  /** True once the operator tapped "Add" on this suggestion during
   *  onboarding — AppLibraryPanel uses this to skip re-suggesting it. */
  picked: boolean;
}

interface OnboardingConciergeHandoff {
  sourceUrl: string;
  suggestions: OnboardingConciergeSuggestion[];
}

function onboardingHandoffKey(tenantId: string | null | undefined): string {
  return `${ONBOARDING_HANDOFF_KEY_PREFIX}:${tenantId || 'unknown'}`;
}

/** Write the onboarding step's resolved suggestions so the Apps panel can
 *  pre-warm its "Suggested for you" row without re-calling discover. Safe
 *  no-op outside the browser or if localStorage is unavailable (private
 *  browsing quota, etc.) — this is a nice-to-have handoff, never load-
 *  bearing for either surface. */
export function saveOnboardingConciergeSuggestions(
  tenantId: string | null | undefined,
  sourceUrl: string,
  suggestions: SuggestedApp[],
  pickedAppIds: ReadonlySet<string>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: OnboardingConciergeHandoff = {
      sourceUrl,
      suggestions: suggestions.map((s) => ({
        appId: s.app.id,
        prefill: s.prefill,
        picked: pickedAppIds.has(s.app.id),
      })),
    };
    window.localStorage.setItem(onboardingHandoffKey(tenantId), JSON.stringify(payload));
  } catch {
    // QuotaExceededError, disabled storage, etc. — non-fatal.
  }
}

/** Read back the onboarding handoff, re-resolving appId -> live
 *  AppDefinition (never trust a stale cached object shape across a
 *  registry version bump — always look the app up fresh). Returns null if
 *  there's nothing cached, it's corrupt, or it's for a different
 *  sourceUrl (branding changed since onboarding, so the suggestions are
 *  stale — the Apps panel's own discover call takes over instead). */
export function readOnboardingConciergeSuggestions(
  tenantId: string | null | undefined,
  currentSourceUrl: string,
): { suggestions: SuggestedApp[]; pickedAppIds: Set<string> } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(onboardingHandoffKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingConciergeHandoff;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.suggestions)) return null;
    if (!currentSourceUrl || parsed.sourceUrl !== currentSourceUrl) return null;
    const suggestions: SuggestedApp[] = [];
    const pickedAppIds = new Set<string>();
    for (const s of parsed.suggestions) {
      const app = getApp(s.appId);
      if (!app || app.comingSoon) continue;
      suggestions.push({ app, prefill: s.prefill || {} });
      if (s.picked) pickedAppIds.add(s.appId);
    }
    return { suggestions, pickedAppIds };
  } catch {
    return null;
  }
}
