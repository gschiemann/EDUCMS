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
} from 'lucide-react';
import type { HelpArticle } from '@/content/help/types';
import { Markdown } from './Markdown';

/**
 * In-app Help Center — slide-in popover triggered by the (?) icon
 * in the top toolbar.
 *
 * Hard-learned design constraints from the partner pilot:
 *   - NO scrim. The drawer is a floating right-edge popover; the
 *     rest of the app stays fully interactive + visible. Earlier
 *     versions had a `bg-slate-900/30` scrim that looked like a
 *     "huge grey bar across the top of the screen."
 *   - NO `font-[family-name:var(--font-fredoka)]` anywhere. That
 *     CSS variable is only loaded inside the printable guide
 *     route; outside it the var resolves to nothing and headings
 *     render with no font-family at all (which read as
 *     "half the text is transparent").
 *   - Solid `bg-white` on EVERY container layer in the drawer
 *     (panel, header, body, footer). Earlier versions had layers
 *     without explicit backgrounds, and the page behind the
 *     drawer (a colorful template thumbnail) bled through.
 *   - Real content visible immediately on open — no empty body
 *     with just a search box waiting for the user to type. The
 *     featured Getting Started Guide card + Quick Links list +
 *     full categorized index all render in the body without any
 *     accordion collapse / lazy reveal.
 *
 * Keyboard:
 *   - Esc closes (or backs out of an active article)
 *   - Click outside the panel closes
 *   - Tab moves through interactive elements normally
 */
export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [q, setQ] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Lazy-load articles on first open, cached for the rest of the session.
  useEffect(() => {
    if (!open || articles !== null) return;
    let cancelled = false;
    fetch('/api/help/articles')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setArticles((data.articles as HelpArticle[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, articles]);

  // Esc key — back out of article first, then close drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeSlug) setActiveSlug(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeSlug]);

  // Click-outside-to-close. Deferred one tick so the click that
  // opened the drawer doesn't immediately re-close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t || !panelRef.current) return;
      if (!panelRef.current.contains(t)) setOpen(false);
    };
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

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
    return Array.from(m.entries()).sort(([a], [b]) => {
      if (a === 'Getting Started') return -1;
      if (b === 'Getting Started') return 1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const TOP_SLUGS = ['pair-a-screen', 'assets', 'playlists-and-schedules', 'emergency-system', 'invite-users'];
  const topArticles = useMemo(() => {
    if (!articles) return [];
    const bySlug = new Map(articles.map((a) => [a.slug, a]));
    return TOP_SLUGS.map((s) => bySlug.get(s)).filter((a): a is HelpArticle => Boolean(a));
  }, [articles]);

  const active = articles && activeSlug ? articles.find((a) => a.slug === activeSlug) : null;
  const isSearching = q.trim().length > 0;

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
        // Inline-style everything load-bearing: position, size, layout,
        // background, z-index. Tailwind's `bg-white` was being silently
        // overridden in the partner's session — body rendered as
        // transparent and the templates-page hero gradient bled through.
        // Inline `style` wins at specificity 1000, so this can't be
        // clobbered by a stray `bg-transparent` Tailwind class loaded
        // later in the CSS layer order.
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Help Center"
          className="rounded-2xl border border-slate-200 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            height: 'calc(100vh - 24px)',
            width: 'min(420px, calc(100vw - 24px))',
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          {/* Header — explicit white background. */}
          <header
            className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0"
            style={{ background: '#ffffff' }}
          >
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

          {/* Body */}
          {articles === null ? (
            <div className="flex-1 flex items-center justify-center text-slate-400" style={{ background: '#ffffff' }}>
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : active ? (
            <ArticleBody article={active} />
          ) : (
            <>
              {/* Search */}
              <div className="px-4 py-3 border-b border-slate-100 shrink-0" style={{ background: '#ffffff' }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
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

              <div className="flex-1 overflow-y-auto" style={{ background: '#ffffff' }}>
                {!isSearching && (
                  <>
                    {/* Featured Getting Started Guide — solid card, no
                        gradient (gradients on a transparent body
                        looked like an orange blob in the partner
                        screenshot). */}
                    <div className="px-4 pt-4 pb-3">
                      <Link
                        href="/guide/getting-started"
                        target="_blank"
                        onClick={() => setOpen(false)}
                        className="group flex items-start gap-3 p-3.5 rounded-xl border border-indigo-200 hover:border-indigo-400 hover:shadow-md transition-all"
                        style={{ background: '#eef2ff' }}
                      >
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                          <BookOpen className="w-5 h-5 text-white" strokeWidth={2.25} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-0.5">
                            Getting Started Guide
                          </div>
                          <p className="text-sm font-semibold text-slate-900 leading-snug">
                            Set up your school in one sitting
                          </p>
                          <p className="mt-1 text-xs text-slate-700 leading-relaxed">
                            Pair → Upload → Playlist → Template → Schedule. Printable PDF.
                          </p>
                          <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700">
                            Open the guide <ExternalLink className="w-3 h-3" />
                          </div>
                        </div>
                      </Link>
                    </div>

                    {/* Quick Links — pinned top-5 articles, one tap each. */}
                    {topArticles.length > 0 && (
                      <div className="px-4 pb-4">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                          Quick Links
                        </div>
                        <ul className="space-y-1.5">
                          {topArticles.map((a) => (
                            <li key={a.slug}>
                              <button
                                onClick={() => setActiveSlug(a.slug)}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition group text-left"
                                style={{ background: '#ffffff' }}
                              >
                                <span className="text-[13px] font-semibold text-slate-800 group-hover:text-indigo-800 truncate">
                                  {a.title}
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 shrink-0" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="border-t border-slate-100" />
                    <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      All Articles
                    </div>
                  </>
                )}

                {/* Article list — flat when searching, grouped otherwise. */}
                {filtered.length === 0 ? (
                  <p className="text-sm text-slate-500 px-5 py-10 text-center">
                    No articles match &ldquo;{q}&rdquo;.
                  </p>
                ) : isSearching ? (
                  <ul className="px-2 py-2 divide-y divide-slate-100">
                    {filtered.map((a) => (
                      <li key={a.slug}>
                        <ArticleRow article={a} onClick={() => setActiveSlug(a.slug)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="pb-4">
                    {grouped.map(([category, items]) => (
                      <section key={category} className="px-2 mt-2">
                        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {category} <span className="text-slate-300">·</span> {items.length}
                        </div>
                        <ul className="divide-y divide-slate-100">
                          {items.map((a) => (
                            <li key={a.slug}>
                              <ArticleRow article={a} onClick={() => setActiveSlug(a.slug)} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              {/* Sticky footer */}
              <footer
                className="px-4 py-3 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0"
                style={{ background: '#f8fafc' }}
              >
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

function ArticleBody({ article }: { article: HelpArticle }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5" style={{ background: '#ffffff' }}>
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
