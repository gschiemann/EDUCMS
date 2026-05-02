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
  VERTICAL_GROUP_NOUN,
  VERTICAL_DEFAULT_BRAND,
  VERTICAL_TEMPLATE_CATEGORIES,
  VERTICAL_ROLE_LABELS,
  DEFAULT_VERTICAL,
  isVertical,
  type Vertical,
} from '@cms/api-types';

export interface TenantCopy {
  vertical: Vertical;
  /** Singular noun for the tenant entity itself ("School" / "Gym" / "Store") */
  orgSingular: string;
  /** Plural variant ("Schools" / "Gyms" / "Stores") */
  orgPlural: string;
  /** Group noun ("District" / "Region" / "Brand") for parent grouping */
  groupSingular: string;
  /** Plural group noun */
  groupPlural: string;
  /** Industry tagline — "K-12 districts, schools, campuses" / "Gyms..." */
  tagline: string;
  /** Emoji for visual identity in chips, headers, etc. */
  emoji: string;
  /** Greeting hero subtitle — vertical-aware substitute for "Wednesday, April 29" prefix */
  dashboardSublineNoun: string;
  /** Settings page section title — currently "School Settings" */
  settingsSectionTitle: string;
  /** Default brand name — "EduSignage" for K12, "VenueOS" otherwise. Tenant.branding.displayName overrides. */
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
  const v: Vertical = isVertical(tenantVertical) ? tenantVertical : DEFAULT_VERTICAL;
  const labels = VERTICAL_LABELS[v];
  const group = VERTICAL_GROUP_NOUN[v];

  return {
    vertical: v,
    orgSingular: labels.singular,
    orgPlural: labels.plural,
    groupSingular: group.singular,
    groupPlural: group.plural,
    tagline: labels.tagline,
    emoji: labels.emoji,
    dashboardSublineNoun: labels.singular,
    settingsSectionTitle: `${labels.singular} settings`,
    defaultBrandName: VERTICAL_DEFAULT_BRAND[v],
    templateCategories: VERTICAL_TEMPLATE_CATEGORIES[v],
    roleLabel: (role: string) => VERTICAL_ROLE_LABELS[v]?.[role] || role,
    showSchoolLevelFilter: v === 'K12',
  };
}
