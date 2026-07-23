/**
 * useTenantCopy — vertical-aware terminology hook.
 *
 * Looks up the current tenant's vertical from useUIStore and returns
 * the right strings for nouns / labels that vary by industry. K12 says
 * "District", a hotel chain says "Region", a QSR says "Brand".
 *
 * Use case: any visible label that currently reads "school" / "district"
 * / "principal" / "classroom" should pull from this hook instead of
 * being hardcoded. Existing K12 pilot copy is preserved exactly when
 * tenant.vertical === 'K12' (the default).
 *
 * 2026-05-03 — VenueOS pivot. Drives the rebrand without forking the
 * codebase. Add new strings here as features need them; don't scatter
 * vertical-aware ternaries throughout the app.
 */

import { useUIStore } from '@/store/ui-store';
import {
  VERTICAL_LABELS,
  VERTICAL_DEFAULT_BRAND,
  VERTICAL_TEMPLATE_CATEGORIES,
  normalizeVertical,
  type Vertical,
} from '@cms/api-types';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { localizedHierarchy, localizedRoleLabel } from '@/i18n/vertical-copy';

export interface TenantCopy {
  vertical: Vertical;
  /** Universal noun for an account/site — "Location" for every vertical. */
  orgSingular: string;
  /** Plural — "Locations". */
  orgPlural: string;
  /** Top-level (org-root) account label — "Primary" for every vertical. */
  groupSingular: string;
  /** Plural of the top-level label. */
  groupPlural: string;
  /** Industry tagline — "K-12 districts, schools, campuses" / "Gyms..." */
  tagline: string;
  /** Emoji for visual identity in chips, headers, etc. */
  emoji: string;
  /** Greeting hero subtitle — vertical-aware substitute for "Wednesday, April 29" prefix */
  dashboardSublineNoun: string;
  /** Settings page section title — currently "School Settings" */
  settingsSectionTitle: string;
  /** Default brand name — "VenueOS" for every vertical. Tenant.branding.displayName overrides. */
  defaultBrandName: string;
  /** Vertical-aware template gallery category tabs */
  templateCategories: ReadonlyArray<{ key: string; label: string }>;
  /** Resolve a DB role enum value to its vertical-aware display label */
  roleLabel: (role: string) => string;
  /** Whether the K12-only school-level filter (Elementary/Middle/High) should show */
  showSchoolLevelFilter: boolean;
}

export function useTenantCopy(): TenantCopy {
  const tenantVertical = useUIStore((s) => (s as any).user?.tenantVertical);
  // normalizeVertical maps canonical AND legacy-alias values (e.g. the
  // pre-rename FITNESS → GYM) to a canonical Vertical, falling back to
  // K12 only for genuinely-missing/unknown values — so a stray legacy
  // industry never silently renders as "school".
  const v: Vertical = normalizeVertical(tenantVertical);
  const labels = VERTICAL_LABELS[v];
  // 2026-07-22 — locale-aware: the hierarchy nouns + role labels are now
  // localized (en byte-identical to the old hardcoded values → zero English
  // regression; es/zh translated). See src/i18n/vertical-copy.ts.
  const { locale } = useLocaleSwitch();
  const h = localizedHierarchy(locale);

  return {
    vertical: v,
    // 2026-06-01 — universal account-hierarchy nouns (Greg): every account is
    // a "Location" regardless of vertical, and the top-level (org-root) account
    // is flagged "Primary". Replaces the old per-vertical entity noun
    // (School/Store/Gym) + group noun (District/Brand/League), which read as
    // fussy and inconsistent across industries. The per-vertical INDUSTRY
    // identity (tagline / emoji / template categories / role labels) stays
    // vertical-aware below — only the hierarchy nouns are unified.
    orgSingular: h.orgSingular,
    orgPlural: h.orgPlural,
    groupSingular: h.groupSingular,
    groupPlural: h.groupPlural,
    tagline: labels.tagline,
    emoji: labels.emoji,
    dashboardSublineNoun: h.orgSingular,
    settingsSectionTitle: h.settingsSectionTitle,
    defaultBrandName: VERTICAL_DEFAULT_BRAND[v],
    templateCategories: VERTICAL_TEMPLATE_CATEGORIES[v],
    roleLabel: (role: string) => localizedRoleLabel(locale, role),
    showSchoolLevelFilter: v === 'K12',
  };
}
