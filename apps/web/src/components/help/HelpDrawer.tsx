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
  MonitorPlay,
  Upload,
  ListVideo,
  ShieldAlert,
  UserPlus,
  Sparkles,
  Cog,
  Wand2,
  CreditCard,
} from 'lucide-react';
import type { HelpArticle } from '@/content/help/types';
import { Markdown } from './Markdown';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

// 2026-05-26 — operator: "its talking about school but i think it
// needs to be redone to be more general and maybe have sections on
// each business line if thats even needed...maybe for sport venue for
// sure because thats a different setup and workflow." Per-vertical
// hero noun + quick-actions + which categories to surface. Sports
// content already exists (sports-getting-started.md, sports-cues.md,
// sports-ribbon.md, sports-run-the-game.md, sports-screens.md); was
// just buried under the generic "school"-flavored hero.
const VERTICAL_NOUN: Record<string, string> = {
  K12: 'school',
  SPORTS: 'venue',
  RESTAURANT: 'restaurant',
  QSR: 'restaurant',
  GYM: 'gym',
  FITNESS: 'gym',
  RETAIL: 'store',
  WORSHIP: 'parish',
  HOSPITALITY: 'hotel',
  BAR: 'bar',
  HEALTHCARE: 'clinic',
  CORPORATE: 'office',
  FASHION: 'boutique',
  OTHER: 'venue',
};
// Categories that are K-12-specific. Hidden from Browse-by-topic when
// the tenant is on any other vertical so we don't tease features they
// can't use.
const K12_ONLY_CATEGORIES = new Set(['Clever']);

/**
 * In-app Help Center — slide-in popover triggered by the (?) icon
 * in the top toolbar.
 *
 * Design language: Intercom Messenger / Linear / Vercel docs —
 * card-led, icon-forward, terse copy. NOT a wall of text rows.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  Help Center                            [✕] │  compact header
 *   ├──────────────────────────────────────────────┤
 *   │  [🔍 Search "pair a screen", "emergency"… ] │  hero search
 *   │                                              │
 *   │  ┌──────────────────────────────────────┐   │
 *   │  │ ✨ Getting Started Guide             │   │  featured (slim)
 *   │  │ Set up your school in one sitting →  │   │
 *   │  └──────────────────────────────────────┘   │
 *   │                                              │
 *   │  Quick actions                               │  ← icon tile grid
 *   │  ┌─────┐ ┌─────┐ ┌─────┐                   │
 *   │  │ 📺  │ │ 📋  │ │ 🚨  │                   │
 *   │  │Pair │ │Build│ │Alert│                   │
 *   │  └─────┘ └─────┘ └─────┘                   │
 *   │                                              │
 *   │  Popular articles                            │
 *   │  • Pair a new screen          → │           │  ← compact rows
 *   │  • Upload assets              → │           │
 *   │  • Playlists & schedules      → │           │
 *   │                                              │
 *   │  Browse by topic                             │
 *   │  ┌────┐ ┌────┐ ┌────┐ ┌────┐               │  ← category chips
 *   │  │Get.│ │Tem.│ │Scr.│ │Eme.│               │
 *   │  └────┘ └────┘ └────┘ └────┘               │
 *   ├──────────────────────────────────────────────┤
 *   │ Full help center ↗     ✉ Contact support   │  sticky footer
 *   └──────────────────────────────────────────────┘
 *
 * Hard-learned constraints:
 *   - NO scrim. Floating right-edge popover, page stays visible.
 *   - Inline `style` for position / size / bg / layout — not
 *     Tailwind classes. Tailwind was being silently overridden
 *     in the partner's session and the body went transparent.
 *   - NO `font-[family-name:var(--font-fredoka)]` anywhere. Var
 *     only resolves inside the printable guide route; outside it
 *     headings rendered with no font-family at all.
 *   - Solid backgrounds on every container layer.
 *   - Real content visible immediately on open — featured guide,
 *     quick action tiles, popular articles, category chips. No
 *     "search box waiting for you to type."
 */
export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [q, setQ] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // 2026-05-26 — vertical-aware copy + content surfacing. SSR-safe:
  // useTenantCopy returns 'K12' (the default) on first paint; the
  // hero re-renders with the right noun once the tenant hydrates.
  const tenantCopy = useTenantCopy();
  const vertical = (tenantCopy?.vertical || 'K12').toUpperCase();
  const venueNoun = VERTICAL_NOUN[vertical] || 'venue';
  const isSports = vertical === 'SPORTS';
  const isK12 = vertical === 'K12';

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeSlug) setActiveSlug(null);
      else if (activeCategory) setActiveCategory(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeSlug, activeCategory]);

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

  const isSearching = q.trim().length > 0;

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

  // Quick-action tiles — vertical-aware. Sports tenants get "Run a
  // game day" as the top action (linking to sports-getting-started)
  // because that's the workflow they're here for; everyone else gets
  // the generic playlist tile.
  const QUICK_ACTIONS: { icon: typeof MonitorPlay; label: string; slug: string; tint: string }[] = isSports
    ? [
        { icon: MonitorPlay, label: 'Pair a screen',   slug: 'pair-a-screen',           tint: '#6366f1' },
        { icon: ListVideo,   label: 'Run a game day',  slug: 'sports-getting-started', tint: '#10b981' },
        { icon: ShieldAlert, label: 'Emergency setup', slug: 'emergency-system',        tint: '#e11d48' },
      ]
    : [
        { icon: MonitorPlay, label: 'Pair a screen',    slug: 'pair-a-screen',           tint: '#6366f1' },
        { icon: ListVideo,   label: 'Build a playlist', slug: 'playlists-and-schedules', tint: '#0ea5e9' },
        { icon: ShieldAlert, label: 'Emergency setup',  slug: 'emergency-system',        tint: '#e11d48' },
      ];

  // Popular articles — vertical-aware. Sports tenants see the
  // game-day workflow + sport-specific surfaces front-and-center.
  const POPULAR_SLUGS = isSports
    ? ['sports-getting-started', 'sports-run-the-game', 'sports-screens', 'sports-ribbon']
    : ['pair-a-screen', 'assets', 'build-a-template', 'invite-users'];
  const popular = useMemo(() => {
    if (!articles) return [];
    const bySlug = new Map(articles.map((a) => [a.slug, a]));
    return POPULAR_SLUGS.map((s) => bySlug.get(s)).filter((a): a is HelpArticle => Boolean(a));
  }, [articles]);

  // Category index — every category gets a chip. Click → drill
  // into a flat list of just that category's articles.
  const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
    'Getting Started': Sparkles,
    'Templates': Wand2,
    'Screens': MonitorPlay,
    'Emergency System': ShieldAlert,
    'Sports': ListVideo, // 2026-05-26 — Sports category surfaced for SPORTS tenants
    'SSO': UserPlus,
    'Clever': UserPlus,
    'Billing': CreditCard,
  };
  const categories = useMemo(() => {
    if (!articles) return [];
    const counts = new Map<string, number>();
    for (const a of articles) {
      const k = a.category || 'Other';
      // 2026-05-26 — hide K-12-only categories (Clever, etc.) on
      // every other vertical. Sports tenants don't need a Clever
      // SIS chip teasing a feature they can't use.
      if (!isK12 && K12_ONLY_CATEGORIES.has(k)) continue;
      // Hide the Sports category for non-Sports tenants to keep the
      // chip grid focused on what the operator is actually using.
      if (!isSports && k === 'Sports') continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => {
      if (a === 'Getting Started') return -1;
      if (b === 'Getting Started') return 1;
      // Sports tenants: float Sports to second slot, right after
      // Getting Started.
      if (isSports && a === 'Sports') return -1;
      if (isSports && b === 'Sports') return 1;
      return a.localeCompare(b);
    });
  }, [articles, isK12, isSports]);

  const active = articles && activeSlug ? articles.find((a) => a.slug === activeSlug) : null;
  const categoryArticles = useMemo(() => {
    if (!articles || !activeCategory) return [];
    return articles.filter((a) => (a.category || 'Other') === activeCategory);
  }, [articles, activeCategory]);

  const headerTitle = active
    ? active.title
    : activeCategory
    ? activeCategory
    : 'Help Center';

  const onBack = active
    ? () => setActiveSlug(null)
    : activeCategory
    ? () => setActiveCategory(null)
    : null;

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
            width: 'min(440px, calc(100vw - 24px))',
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          {/* Header — compact, with optional back button when drilled in */}
          <header
            className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0"
            style={{ background: '#ffffff' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {onBack && (
                <button
                  onClick={onBack}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <h2 className="text-[15px] font-semibold text-slate-900 truncate">{headerTitle}</h2>
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
            <div
              className="flex-1 flex items-center justify-center text-slate-400"
              style={{ background: '#ffffff' }}
            >
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : active ? (
            <ArticleBody article={active} />
          ) : activeCategory ? (
            <CategoryList articles={categoryArticles} onPick={setActiveSlug} />
          ) : (
            <>
              {/* Hero search — friendly placeholder that suggests common queries */}
              <div className="px-4 pt-4 pb-3 shrink-0" style={{ background: '#ffffff' }}>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="search"
                    placeholder="Search “pair a screen”, “emergency”…"
                    autoComplete="off"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Body region scrolls; everything below the search is in here */}
              <div className="flex-1 overflow-y-auto" style={{ background: '#ffffff' }}>
                {isSearching ? (
                  filtered.length === 0 ? (
                    <p className="text-sm text-slate-500 px-5 py-10 text-center">
                      No articles match &ldquo;{q}&rdquo;.
                    </p>
                  ) : (
                    <ul className="px-3 py-3 space-y-1">
                      {filtered.map((a) => (
                        <li key={a.slug}>
                          <ArticleCard article={a} onClick={() => setActiveSlug(a.slug)} />
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <div className="px-4 pt-2 pb-5 space-y-5">
                    {/* Featured Getting Started Guide — slim card, single
                        solid color, BookOpen icon left of label. Opens
                        printable PDF guide in a new tab. */}
                    {/* 2026-05-26 — vertical-aware hero. Sports
                        tenants get a different anchor article + copy
                        because their first-day workflow is "set up
                        and run a game day," not "set up the dashboard."
                        Other verticals get the generic noun-swapped
                        copy ("school" / "venue" / "store" / "gym" /
                        "restaurant" / etc.) so a fitness chain doesn't
                        see "school" anywhere it doesn't make sense. */}
                    <Link
                      href={isSports ? '/help/sports-getting-started' : '/guide/getting-started'}
                      target="_blank"
                      onClick={() => setOpen(false)}
                      className="group flex items-center gap-3 p-3.5 rounded-xl border border-indigo-200 hover:border-indigo-400 hover:shadow-md transition-all"
                      style={{ background: '#eef2ff' }}
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                        <BookOpen className="w-5 h-5 text-white" strokeWidth={2.25} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                          {isSports ? 'VenueOS Sports Guide' : 'Getting Started Guide'}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 leading-snug truncate">
                          {isSports
                            ? 'Set up + run your first game day'
                            : `Set up your ${venueNoun} in one sitting`}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-indigo-700 shrink-0" />
                    </Link>

                    {/* Quick actions — 3 big icon tiles, one tap each */}
                    <section>
                      <SectionLabel>Quick actions</SectionLabel>
                      <div className="grid grid-cols-3 gap-2">
                        {QUICK_ACTIONS.map(({ icon: Icon, label, slug, tint }) => (
                          <button
                            key={slug}
                            onClick={() => setActiveSlug(slug)}
                            className="flex flex-col items-center justify-center gap-2 py-3.5 px-2 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition group"
                            style={{ background: '#ffffff' }}
                          >
                            <div
                              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                              style={{ background: `${tint}1a` }}
                            >
                              <Icon className="w-5 h-5" style={{ color: tint }} strokeWidth={2.25} />
                            </div>
                            <span className="text-[11px] font-semibold text-slate-700 group-hover:text-slate-900 leading-tight text-center">
                              {label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    {/* Popular articles — 4 compact rows */}
                    {popular.length > 0 && (
                      <section>
                        <SectionLabel>Popular</SectionLabel>
                        <ul className="space-y-1.5">
                          {popular.map((a) => (
                            <li key={a.slug}>
                              <button
                                onClick={() => setActiveSlug(a.slug)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition group text-left"
                                style={{ background: '#ffffff' }}
                              >
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                                <span className="text-[13px] font-semibold text-slate-800 group-hover:text-indigo-800 truncate flex-1">
                                  {a.title}
                                </span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 shrink-0" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {/* Categories — pill chips */}
                    {categories.length > 0 && (
                      <section>
                        <SectionLabel>Browse by topic</SectionLabel>
                        <div className="grid grid-cols-2 gap-2">
                          {categories.map(([cat, n]) => {
                            const Icon = CATEGORY_ICONS[cat] ?? Cog;
                            return (
                              <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition group text-left"
                                style={{ background: '#ffffff' }}
                              >
                                <Icon className="w-4 h-4 text-slate-500 group-hover:text-slate-700 shrink-0" strokeWidth={2} />
                                <span className="text-[12px] font-semibold text-slate-700 group-hover:text-slate-900 truncate flex-1">
                                  {cat}
                                </span>
                                <span className="text-[10px] font-medium text-slate-400 shrink-0">{n}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}
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
                  href="mailto:support@venue-os.app"
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-1">
      {children}
    </div>
  );
}

function ArticleCard({ article, onClick }: { article: HelpArticle; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition group"
      style={{ background: '#ffffff' }}
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

function CategoryList({ articles, onPick }: { articles: HelpArticle[]; onPick: (slug: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5" style={{ background: '#ffffff' }}>
      {articles.map((a) => (
        <ArticleCard key={a.slug} article={a} onClick={() => onPick(a.slug)} />
      ))}
    </div>
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
