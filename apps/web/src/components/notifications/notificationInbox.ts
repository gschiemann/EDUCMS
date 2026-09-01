/**
 * §M21 Notifications — the derivation behind the inbox.
 *
 * Pure: no React, no DOM, no network. The page draws what this returns and
 * counts nothing itself, so the tab counts, the filter and the rows can never
 * disagree about which category a row belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THREE CATEGORIES AND NOT §M21'S FOUR.
 *
 * §M21 names four: Requires action · Delivery exceptions · Reviews · System
 * updates. §19 outranks that list — "If these contracts are not available,
 * the design must show Unknown or omit the claim. It must not invent
 * success." Checked against what the server actually emits:
 *
 *   EMITTED   SCREEN_OFFLINE  (notifications.service.ts — the offline scanner,
 *                              store-scoped and rolled up to the parent)
 *             INFRA_EVENT     (service + super-license.controller)
 *             INFO            (submissions ×2, schedules, kiosk help)
 *
 *   DECLARED BUT NEVER EMITTED — no call site anywhere in apps/api:
 *             SYNC_FAILED · EMERGENCY_TRIGGERED · INVITE_ACCEPTED
 *
 * So `kind` alone cannot separate Reviews from System updates: BOTH halves of
 * the review workflow ship as `INFO` and are told apart only by their link
 * (`/reviews?id=…` to a reviewer, `/submissions/…` back to the author). That
 * is what `categorize` reads.
 *
 * "Requires action" gets no tab of its own, deliberately. Nothing the server
 * emits means that distinctly — a review awaiting you and an offline screen
 * are both already actionable, so a fourth tab would re-list the other two
 * under a new name and inflate its own count. And §M21's own sentence says
 * where the one genuinely urgent state lives: "Emergency active state is not
 * merely a notification; it remains persistent in the shell" — it is the
 * red strip under the header (TopToolbar §6.3), not a row in here.
 *
 * A tab that can never fill is the "Coming soon wearing a real-button
 * costume" the audit surface bans. Three real tabs beat four with a dead one.
 */

export interface InboxNotification {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export type InboxCategory = 'exceptions' | 'reviews' | 'system';

/** Tab labels. §14.1 nouns; no school-only vocabulary. */
export const CATEGORY_LABEL: Record<InboxCategory, string> = {
  exceptions: 'Delivery exceptions',
  reviews: 'Reviews',
  system: 'System updates',
};

/**
 * One line saying what the category IS, shown when it is empty so an operator
 * learns the shape of the thing they are not seeing (§13 Empty: "Explain why
 * the object matters").
 */
export const CATEGORY_BLURB: Record<InboxCategory, string> = {
  exceptions: 'Screens that stopped answering, and other delivery problems we noticed.',
  reviews: 'Work submitted for approval, and decisions on work you submitted.',
  system: 'Account, licence and platform messages.',
};

/**
 * Which bucket a notification belongs in.
 *
 * Link-based rather than kind-based for the review pair, because the server
 * gives both of them `kind: 'INFO'` — see the header note. Matching is on the
 * path PREFIX so a query string (`/reviews?id=…`) still lands.
 */
export function categorize(n: InboxNotification): InboxCategory {
  if (n.kind === 'SCREEN_OFFLINE' || n.kind === 'SYNC_FAILED') return 'exceptions';
  const link = n.link ?? '';
  if (/^\/(reviews|submissions)(\/|\?|$)/.test(link)) return 'reviews';
  return 'system';
}

export interface InboxTab {
  key: InboxCategory | 'all';
  label: string;
  /** Rows in this tab. */
  count: number;
  /** Unread rows in this tab — what the badge means. */
  unread: number;
}

export interface Inbox {
  tabs: InboxTab[];
  /** Every row, newest first, each tagged with its category. */
  rows: Array<InboxNotification & { category: InboxCategory }>;
  unreadTotal: number;
}

/**
 * Newest first. The server already orders by `createdAt desc`, but a row with
 * an unparseable stamp must not be able to reorder the list or crash the sort
 * — it sinks to the bottom and keeps its own place.
 */
function stamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

export function buildInbox(items: InboxNotification[] | undefined | null): Inbox {
  const rows = (items ?? [])
    .map((n) => ({ ...n, category: categorize(n) }))
    .sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));

  const tab = (key: InboxCategory): InboxTab => {
    const mine = rows.filter((r) => r.category === key);
    return {
      key,
      label: CATEGORY_LABEL[key],
      count: mine.length,
      unread: mine.filter((r) => !r.isRead).length,
    };
  };

  const unreadTotal = rows.filter((r) => !r.isRead).length;

  return {
    tabs: [
      { key: 'all', label: 'All', count: rows.length, unread: unreadTotal },
      tab('exceptions'),
      tab('reviews'),
      tab('system'),
    ],
    rows,
    unreadTotal,
  };
}

/**
 * Compact age, in the same shape the fleet inbox uses ("6m", "3h", "2d").
 *
 * A FUTURE stamp returns null rather than a negative age: signage-adjacent
 * clocks run minutes of skew, and "in -4m" is worse than saying nothing. The
 * caller renders the absent case as no timestamp at all.
 */
export function relativeAge(iso: string, now: number = Date.now()): string | null {
  const t = stamp(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.floor((now - t) / 1000);
  if (s < 0) return null;
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
