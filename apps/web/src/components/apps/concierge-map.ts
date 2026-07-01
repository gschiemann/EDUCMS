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

import type { AppCategory } from './app-registry';

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
