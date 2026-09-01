"use client";

import { useMemo, useRef, useState } from 'react';
import {
  Bell, CheckCheck, WifiOff, FileCheck2, Info, ChevronRight, Loader2, RefreshCw,
} from 'lucide-react';
import {
  buildInbox, relativeAge, CATEGORY_BLURB,
  type InboxCategory, type InboxNotification,
} from './notificationInbox';
import { cn } from '@/lib/utils';

/**
 * M21 — Notifications, the view.
 *
 * "Use a full-screen inbox or properly managed sheet, not a small desktop
 * dropdown squeezed onto a phone."
 *
 * Until now the bell's dropdown was the only notifications surface in the
 * app: no route, no categories, no way to see anything older than the 20 the
 * panel fetched, and on a phone a `fixed left-2 right-2` panel hanging off
 * the header. This is what the bell should have opened all along; the
 * dropdown still handles the desktop glance.
 *
 * PRESENTATIONAL ON PURPOSE. Every read and every mutation is a prop, so the
 * four §13 states can be photographed from a fixture on a production build
 * (apps/web/scripts/harness/mobile-home-mock.page.tsx) instead of being taken
 * on trust. The route at app/[schoolId]/notifications/page.tsx is the thin
 * container that supplies them.
 *
 * THE CATEGORY SET IS THE DATA'S, NOT THE SPEC'S — see notificationInbox.ts.
 * §M21 names four; the server emits three distinguishable kinds, so there are
 * three tabs and the reasoning is written down rather than the fourth tab
 * being shipped empty.
 *
 * NO PUSH PROMISE (§16, §M21: "Do not promise background push until
 * implemented"). Web Push is not built — no subscription, no service-worker
 * notification handler, no APNs/FCM. So the page says plainly that these
 * arrive while VenueOS is open, instead of letting an operator assume their
 * phone will buzz during an incident.
 */
export interface NotificationsInboxProps {
  items: InboxNotification[] | undefined;
  isPending: boolean;
  isError: boolean;
  /** A retry already in flight — disables the retry control. */
  isFetching?: boolean;
  /** Marks read where needed and navigates. The container owns both. */
  onOpen: (n: InboxNotification) => void;
  onMarkAllRead: () => void;
  onRetry: () => void;
}

export function NotificationsInbox({
  items, isPending, isError, isFetching, onOpen, onMarkAllRead, onRetry,
}: NotificationsInboxProps) {
  const [tab, setTab] = useState<InboxCategory | 'all'>('all');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const inbox = useMemo(() => buildInbox(items), [items]);
  const visible = tab === 'all' ? inbox.rows : inbox.rows.filter((r) => r.category === tab);

  /**
   * A COUNT IS ONLY A COUNT WHEN SOMETHING WAS COUNTED.
   *
   * `buildInbox(undefined)` returns zeros, and printing those while the read
   * is still in flight — or after it failed — tells an operator their inbox is
   * empty when the truth is that we have not looked. Same discipline as the
   * fleet home's gray "Not reported" tiles (§8.4: gray means explicitly
   * unknown; §19: show Unknown rather than invent success). So the header
   * subtitle and every tab count are suppressed unless a real list arrived.
   *
   * §13 "API unavailable: preserve last-known data" is why this keys off the
   * PRESENCE OF ITEMS rather than off `isError`: a failed refetch that still
   * has React Query's previous list keeps showing that list, with a banner
   * saying it may be stale, instead of throwing away what we know.
   */
  const countsKnown = Array.isArray(items);
  const hasCached = countsKnown && inbox.rows.length > 0;
  const showStaleBanner = isError && hasCached;

  /**
   * §18 / the 2026-09-01 audit's a11y note: the app's other tab strips have
   * no arrow-key contract. This one does — roving tabindex, Home/End, and
   * wrap-around, so a keyboard reaches every category without tabbing through
   * the rows in between.
   */
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = inbox.tabs.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % n;
    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(inbox.tabs[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="max-w-3xl mx-auto pb-4">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-[30px] font-black text-slate-900">Notifications</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {!countsKnown
              ? 'Checking for new messages…'
              : inbox.unreadTotal > 0
                ? `${inbox.unreadTotal} unread of ${inbox.rows.length}`
                : `${inbox.rows.length} ${inbox.rows.length === 1 ? 'message' : 'messages'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={inbox.unreadTotal === 0}
          className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 disabled:text-slate-300 disabled:bg-slate-50 active:bg-slate-50"
        >
          <CheckCheck className="w-4 h-4" aria-hidden />
          Mark all read
        </button>
      </header>

      {/* Category tabs. Horizontally scrollable so four chips survive 360px
          without wrapping the header (§7 / §M21). */}
      <div
        role="tablist"
        aria-label="Notification categories"
        className="mt-4 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
      >
        {inbox.tabs.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => setTab(t.key)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border text-[13px] font-bold transition-colors',
                active
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-600 active:bg-slate-50',
              )}
            >
              {t.label}
              {countsKnown && (
                <span
                  className={cn(
                    'text-[11px] font-black tabular-nums',
                    active ? 'text-white/60' : 'text-slate-400',
                  )}
                >
                  {t.count}
                </span>
              )}
              {countsKnown && t.unread > 0 && (
                <span
                  className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-white' : 'bg-indigo-500')}
                  aria-label={`${t.unread} unread`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* §13 API unavailable, WITH last-known data: keep the list, say plainly
          that it may be stale, keep the retry. Throwing away rows we already
          have would be a worse answer than showing them labelled. */}
      {showStaleBanner && (
        <div
          role="status"
          data-testid="notifications-stale"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5"
        >
          <RefreshCw className="mt-0.5 w-4 h-4 shrink-0 text-amber-600" aria-hidden />
          <p className="text-[12px] leading-snug text-amber-900">
            Couldn’t refresh just now — showing the last list this device
            received. Anything newer isn’t here yet.
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={!!isFetching}
            className="ml-auto shrink-0 self-center min-h-[44px] px-2 text-[12px] font-bold text-amber-900 underline underline-offset-2 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mt-4">
        {isPending ? (
          <Skeleton />
        ) : isError && !hasCached ? (
          <Unavailable onRetry={onRetry} busy={!!isFetching} />
        ) : visible.length === 0 ? (
          <Empty tab={tab} onClear={() => setTab('all')} anyAtAll={inbox.rows.length > 0} />
        ) : (
          <ul className="rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {visible.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpen(n)}
                  data-testid="notification-row"
                  data-read={n.isRead ? 'read' : 'unread'}
                  data-category={n.category}
                  className={cn(
                    'w-full text-left flex items-start gap-3 px-4 py-3 min-h-[64px]',
                    n.isRead ? 'bg-white active:bg-slate-50' : 'bg-indigo-50/40 active:bg-indigo-50',
                  )}
                >
                  <span className="mt-0.5 shrink-0">{categoryIcon(n.category)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          'block text-[13.5px] leading-snug',
                          n.isRead ? 'font-semibold text-slate-700' : 'font-bold text-slate-900',
                        )}
                      >
                        {n.title}
                      </span>
                      {!n.isRead && (
                        <span
                          className="mt-1.5 shrink-0 w-2 h-2 rounded-full bg-indigo-500"
                          aria-label="Unread"
                        />
                      )}
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block text-[12px] leading-snug text-slate-500 line-clamp-2">
                        {n.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-slate-400">
                      {[relativeAge(n.createdAt), CATEGORY_LABEL_SHORT[n.category]]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {n.link && <ChevronRight className="w-4 h-4 shrink-0 mt-1 text-slate-300" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* §16 — the honest footnote. Nothing here promises a buzzing phone. */}
      <p className="mt-4 px-1 text-[11.5px] leading-snug text-slate-400">
        These arrive while VenueOS is open. Your phone won’t alert you when the
        app is closed — during an active emergency, watch the alert banner at
        the top of the app.
      </p>
    </div>
  );
}

/** Short forms for the row's metadata line, where the full label is too long. */
const CATEGORY_LABEL_SHORT: Record<InboxCategory, string> = {
  exceptions: 'Delivery',
  reviews: 'Review',
  system: 'System',
};

function categoryIcon(c: InboxCategory) {
  if (c === 'exceptions') return <WifiOff className="w-4 h-4 text-amber-500" aria-hidden />;
  if (c === 'reviews') return <FileCheck2 className="w-4 h-4 text-indigo-500" aria-hidden />;
  return <Info className="w-4 h-4 text-slate-400" aria-hidden />;
}

/** §13 Loading — geometry-matched, never a bare centred spinner. */
function Skeleton() {
  return (
    <div
      className="rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100 animate-pulse"
      data-testid="notifications-skeleton"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="px-4 py-3 min-h-[64px] flex items-start gap-3">
          <div className="mt-0.5 w-4 h-4 rounded bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-slate-200" />
            <div className="h-2.5 w-1/2 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * §13 Empty vs No results — deliberately two different screens. The first-run
 * empty state must never be shown to someone who simply filtered everything
 * out; that one keeps the filter context and offers a way back.
 */
function Empty({
  tab, onClear, anyAtAll,
}: {
  tab: InboxCategory | 'all';
  onClear: () => void;
  anyAtAll: boolean;
}) {
  const filtered = tab !== 'all' && anyAtAll;
  return (
    <div
      className="rounded-2xl bg-white border border-slate-200 px-5 py-10 text-center"
      data-testid={filtered ? 'notifications-no-results' : 'notifications-empty'}
    >
      <Bell className="w-6 h-6 mx-auto text-slate-300" aria-hidden />
      <p className="mt-3 text-[15px] font-bold text-slate-900">
        {filtered ? 'Nothing in this category' : 'No notifications yet'}
      </p>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500 max-w-sm mx-auto">
        {tab === 'all'
          ? 'VenueOS writes here when a screen stops answering, when work needs a review, and when something changes on your account.'
          : CATEGORY_BLURB[tab]}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 inline-flex items-center min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold active:bg-slate-800"
        >
          Show all notifications
        </button>
      )}
    </div>
  );
}

/** §13 API unavailable — say so, keep the retry, claim nothing about the data. */
function Unavailable({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <div
      className="rounded-2xl bg-white border border-amber-200 px-5 py-8 text-center"
      data-testid="notifications-error"
    >
      <p className="text-[15px] font-bold text-slate-900">Can’t load notifications</p>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500">
        VenueOS could not reach the server, so this list may be incomplete or
        out of date.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold disabled:opacity-60 active:bg-slate-800"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
        Try again
      </button>
    </div>
  );
}
