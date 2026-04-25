'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  HelpCircle,
  X,
  Search,
  ExternalLink,
  Mail,
  ArrowLeft,
  Loader2,
  BookOpen,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { HelpArticle } from '@/content/help/types';
import { Markdown } from './Markdown';

/**
 * In-app Help Center — slide-in drawer triggered by the (?) icon in
 * the top toolbar. Designed to feel like Intercom / Linear / Notion's
 * help widgets.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  Help Center                            [✕] │  compact header
 *   │  Search…                                    │
 *   ├─────────────────────────────────────────────┤
 *   │  ┌─────────────────────────────────────┐    │
 *   │  │ ★ Getting Started Guide             │    │  featured card
 *   │  │ Printable walkthrough — pair screens│    │  → /guide/getting-started
 *   │  │ → upload → playlist → templates     │    │
 *   │  └─────────────────────────────────────┘    │
 *   │                                             │
 *   │  Getting Started      (2 articles)  ▾      │  category groups
 *   │   • Getting started with EduSignage         │
 *   │   • Inviting staff and assigning roles      │
 *   │  Templates            (3 articles)  ▾      │
 *   │   • Building a custom template              │
 *   │   …                                         │
 *   ├─────────────────────────────────────────────┤
 *   │  Full help center  ↗      Contact support  │  sticky footer
 *   └─────────────────────────────────────────────┘
 *
 * Design choices that fix prior bugs:
 *   - No `font-[family-name:var(--font-fredoka)]` calls. The Fredoka
 *     CSS variable isn't loaded outside the printable guide route,
 *     and the failed lookup was making headings render with no font
 *     family at all (the symptom Integration Lead saw as "half the
 *     text is transparent"). Replaced with regular Tailwind weights.
 *   - Solid scrim (bg-slate-900/30) instead of `backdrop-blur-sm`.
 *     The blur stacked under the toolbar was reading as a "huge grey
 *     bar across the top" on lighter pages.
 *   - Compact sticky header — no chunky padding pushing content down.
 *   - Featured guide card at top so customers immediately see the
 *     full-walkthrough doc without having to scroll/search.
 *   - Articles grouped by category (not one flat list) so the drawer
 *     feels organized at a glance.
 */
export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [q, setQ] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLElement | null>(null);

  // Click-outside-to-close. We don't render a scrim anymore — the
  // panel is a floating right-edge popover, the rest of the app
  // stays fully interactive — so we use a window-level mousedown
  // listener to detect taps outside the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        // Don't immediately close on the very first click — that
        // could be the click that opened the drawer bubbling here.
        // Schedule for the next tick.
        setTimeout(() => setOpen(false), 0);
      }
    };
    // Defer attachment so the opening click doesn't immediately close us.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Lazy-load articles on first open. Cached for the rest of the session.
  useEffect(() => {
    if (!open || articles !== null) return;
    let cancelled = false;
    fetch('/api/help/articles')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setArticles(data.articles as HelpArticle[]);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, articles]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeSlug) setActiveSlug(null);
        else setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeSlug]);

  // Filter results — when searching, ignore category grouping and show a
  // flat ranked list. When not searching, group by category.
  const filtered = useMemo(() => {
    if (!articles) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.excerpt.toLowerCase().includes(needle) ||
        a.body.toLowerCase().includes(needle),
    );
  }, [articles, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, HelpArticle[]>();
    for (const a of filtered) {
      const key = a.category || 'Other';
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    // Stable category order — Getting Started first, then alphabetical.
    return Array.from(m.entries()).sort(([a], [b]) => {
      if (a === 'Getting Started') return -1;
      if (b === 'Getting Started') return 1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const active = articles && activeSlug ? articles.find((a) => a.slug === activeSlug) : null;
  const isSearching = q.trim().length > 0;

  // Top articles pinned at the top of the drawer for one-click access.
  // Slugs picked from /api/help/articles for the highest-impact onboarding
  // tasks — same slugs the marketing landing nav links to.
  const TOP_SLUGS = [
    'pair-a-screen',
    'assets',
    'playlists-and-schedules',
    'emergency-system',
    'invite-users',
  ];
  const topArticles = useMemo(() => {
    if (!articles) return [];
    const bySlug = new Map(articles.map((a) => [a.slug, a]));
    return TOP_SLUGS.map((s) => bySlug.get(s)).filter((a): a is HelpArticle => Boolean(a));
  }, [articles]);

  function toggleCategory(name: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 hover:text-indigo-600 transition-all shadow-sm"
        title="Help and documentation"
        aria-label="Open help"
      >
        <HelpCircle className="w-[18px] h-[18px]" strokeWidth={2} />
      </button>

      {open && (
        // No scrim — the drawer is a floating right-edge popover.
        // The rest of the app stays fully interactive + visible (the
        // partner reported a "huge grey bar across the top" with the
        // prior scrim, so it's gone). Click-outside dismissal is
        // handled by the window mousedown listener above.
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Help Center"
          className="fixed top-3 right-3 bottom-3 z-[60] w-[min(420px,calc(100vw-1.5rem))] bg-white border border-slate-200 rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.18)] flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
        >
            {/* Compact sticky header — no chunky padding. */}
            <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-white">
              <div className="flex items-center gap-2 min-w-0">
                {active && (
                  <button
                    onClick={() => setActiveSlug(null)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
                    aria-label="Back to article list"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="text-[15px] font-semibold text-slate-900 truncate">
                  {active ? active.title : 'Help Center'}
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
                aria-label="Close help"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            {articles === null ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : active ? (
              <ArticleView article={active} />
            ) : (
              <>
                {/* Search */}
                <div className="px-4 py-3 border-b border-slate-100 bg-white">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="search"
                      placeholder="Search articles…"
                      autoComplete="off"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* Featured Getting Started Guide card + Top Articles —
                      only when not searching. The pair gives the customer
                      one-click access to the printable walkthrough AND the
                      five most-asked onboarding articles right at the top
                      of the drawer, no scrolling required. */}
                  {!isSearching && (
                    <>
                      <div className="px-4 pt-4 pb-2">
                        <Link
                          href="/guide/getting-started"
                          target="_blank"
                          onClick={() => setOpen(false)}
                          className="group block rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-sm">
                              <BookOpen className="w-5 h-5 text-white" strokeWidth={2.25} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Sparkles className="w-3.5 h-3.5 text-fuchsia-600" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-700">
                                  Getting Started Guide
                                </span>
                              </div>
                              <p className="text-sm font-semibold text-slate-900 leading-snug">
                                Set up your school in one sitting
                              </p>
                              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                                Pair a screen → upload → playlist → template → schedule. Printable PDF.
                              </p>
                              <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 group-hover:text-indigo-800">
                                Open the guide <ExternalLink className="w-3 h-3" />
                              </div>
                            </div>
                          </div>
                        </Link>
                      </div>

                      {/* Quick links — direct one-tap access to the most-used
                          articles. These are also in the categorized list
                          below; surfacing them up here means a customer who
                          opens the drawer for the first time sees real
                          content immediately, not just a search box. */}
                      {topArticles.length > 0 && (
                        <div className="px-4 pt-2 pb-1">
                          <div className="flex items-center gap-1.5 mb-2">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                              Quick Links
                            </span>
                          </div>
                          <ul className="grid gap-1.5">
                            {topArticles.map((a) => (
                              <li key={a.slug}>
                                <button
                                  onClick={() => setActiveSlug(a.slug)}
                                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 transition group text-left"
                                >
                                  <span className="text-[13px] font-semibold text-slate-800 group-hover:text-indigo-800 truncate">
                                    {a.title}
                                  </span>
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 shrink-0 ml-2" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Section divider before the full categorized index. */}
                      <div className="px-4 pt-3 pb-1">
                        <div className="border-t border-slate-100" />
                        <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Browse all articles
                        </div>
                      </div>
                    </>
                  )}

                  {/* Article list — grouped by category, or flat when searching. */}
                  {filtered.length === 0 ? (
                    <p className="text-sm text-slate-500 px-5 py-10 text-center">
                      No articles match &ldquo;{q}&rdquo;.
                    </p>
                  ) : isSearching ? (
                    <ul className="px-2 pb-3 divide-y divide-slate-100">
                      {filtered.map((a) => (
                        <li key={a.slug}>
                          <ArticleRow article={a} onClick={() => setActiveSlug(a.slug)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="pb-3">
                      {grouped.map(([category, items]) => {
                        const isCollapsed = collapsed.has(category);
                        return (
                          <section key={category} className="px-2 mt-2">
                            <button
                              type="button"
                              onClick={() => toggleCategory(category)}
                              className="w-full px-3 py-2 flex items-center justify-between text-left rounded-lg hover:bg-slate-50 transition group"
                              aria-expanded={!isCollapsed}
                            >
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-slate-700">
                                {category}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-slate-400">
                                  {items.length}
                                </span>
                                <ChevronRight
                                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                                    isCollapsed ? '' : 'rotate-90'
                                  }`}
                                />
                              </span>
                            </button>
                            {!isCollapsed && (
                              <ul className="divide-y divide-slate-100">
                                {items.map((a) => (
                                  <li key={a.slug}>
                                    <ArticleRow article={a} onClick={() => setActiveSlug(a.slug)} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Sticky footer */}
                <footer className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                  <Link
                    href="/help"
                    target="_blank"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1.5"
                  >
                    Full help center <ExternalLink className="w-3 h-3" />
                  </Link>
                  <a
                    href="mailto:support@edusignage.app"
                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5" /> Contact support
                  </a>
                </footer>
              </>
            )}
        </aside>
      )}
    </>
  );
}

function ArticleRow({ article, onClick }: { article: HelpArticle; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 transition group"
    >
      <p className="text-[13px] font-semibold text-slate-900 group-hover:text-indigo-700 leading-snug">
        {article.title}
      </p>
      {article.excerpt && (
        <p className="mt-0.5 text-xs text-slate-500 line-clamp-2 leading-relaxed">
          {article.excerpt}
        </p>
      )}
    </button>
  );
}

function ArticleView({ article }: { article: HelpArticle }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div className="text-[10px] font-bold tracking-wider uppercase text-indigo-600 mb-1">
        {article.category}
      </div>
      {article.excerpt && (
        <p className="text-sm text-slate-600 mb-5 leading-relaxed">{article.excerpt}</p>
      )}
      <Markdown source={stripTitle(article.body)} />
      <div className="mt-8 pt-5 border-t border-slate-100">
        <Link
          href={`/help/${article.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Open in full help center <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function stripTitle(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
