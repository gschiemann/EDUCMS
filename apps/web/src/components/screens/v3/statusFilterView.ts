/**
 * Screens toolbar — how the ONE status filter is drawn (pill cleanup,
 * 2026-11-02, owner: "make the behaviour obvious and consistent").
 *
 * The page has a single `FilterKey`. It is shown in two places:
 *   - the TABS carry the main statuses (All · Needs attention · Offline);
 *   - the FILTER menu lists every status a person can narrow to.
 *
 * Rule: a status that has a tab is shown BY its tab — picking "Offline" in the
 * Filter menu underlines the Offline tab and the Filter button shows no count
 * (the tab already says it). A status with no tab (Content behind, Push
 * delayed) underlines NO tab and shows as the Filter button's count. So at any
 * moment exactly one of the two says what is filtered, never both, never
 * neither (except "All", which is the unfiltered state and its own tab).
 *
 * Pure — no React — so both rules are unit-tested.
 */
import type { FilterChip, FilterKey } from './screenOps';

/** Statuses that have their own tab, in tab order. */
export const TAB_STATUSES: readonly FilterKey[] = ['all', 'attention', 'offline'];

/** Statuses offered in the Filter menu, in menu order. */
export const MENU_STATUSES: readonly FilterKey[] = ['attention', 'content-behind', 'push-delayed', 'offline'];

export function isTabStatus(key: FilterKey): boolean {
  return TAB_STATUSES.includes(key);
}

export interface StatusFilterView {
  /** The tab to underline, or null when the active status has no tab. */
  activeTab: FilterKey | null;
  /** What the Filter button counts: 1 only for a status with no tab. */
  menuCount: number;
  /** The tabs to draw. Offline appears only when it has screens, or is active. */
  tabs: FilterChip[];
  /** The Filter menu rows; a zero-count row is disabled unless it is active. */
  menu: Array<FilterChip & { disabled: boolean; hasTab: boolean }>;
}

export function statusFilterView(chips: FilterChip[], filter: FilterKey): StatusFilterView {
  const byKey = new Map(chips.map((c) => [c.key, c]));
  const tabs = TAB_STATUSES
    .map((k) => byKey.get(k))
    .filter((c): c is FilterChip => !!c)
    .filter((c) => c.key !== 'offline' || c.count > 0 || c.key === filter);
  const menu = MENU_STATUSES
    .map((k) => byKey.get(k))
    .filter((c): c is FilterChip => !!c)
    .map((c) => ({ ...c, disabled: c.count === 0 && c.key !== filter, hasTab: isTabStatus(c.key) }));
  const onTab = tabs.some((c) => c.key === filter);
  return {
    activeTab: onTab ? filter : null,
    menuCount: filter !== 'all' && !onTab ? 1 : 0,
    tabs,
    menu,
  };
}
