'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight, BookOpen, Mail, FileText, Sparkles, Printer } from 'lucide-react';
import { HELP_CATEGORIES, type HelpArticle, type HelpCategory } from '@/content/help/types';

/**
 * Help hub — compact header + featured guide card + category grid +
 * categorized article list. Replaces the previous version that opened
 * with a giant "How can we help?" hero + huge centered search input
 * (Integration Lead called it "ugly ass big bar across the top").
 *
 * Top region is now an inline header strip with a smaller wordmark, a
 * tight inline search, and a one-card spotlight for the printable
 * Getting Started guide so first-time customers go straight to the
 * walk-through instead of scanning a backlog of articles.
 */
export function HelpHub({ articles }: { articles: HelpArticle[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.excerpt.toLowerCase().includes(needle) ||
        a.body.toLowerCase().includes(needle) ||
        a.category.toLowerCase().includes(needle),
    );
  }, [articles, q]);

  const byCategory = useMemo(() => {
    const m = new Map<HelpCategory, HelpArticle[]>();
    for (const a of filtered) {
      const list = m.get(a.category) ?? [];
      list.push(a);
      m.set(a.category, list);
    }
    return m;
  }, [filtered]);

  return (
    <>
      {/* ─── Compact header strip ─────────────────────────────
         Inline, eyebrow + title + description + search on a
         single tight band instead of a centered hero. */}
      <section className="pt-12 pb-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[11px] font-semibold text-indigo-700 mb-3">
                <BookOpen className="w-3 h-3" />
                Help center
              </div>
              <h1 className="font-[family-name:var(--font-fredoka)] text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
                How can we help?
              </h1>
              <p className="mt-1.5 text-sm md:text-base text-slate-600 max-w-xl">
                Guides, how-tos, and answers — written for teachers, techs, and district admins.
              </p>
            </div>
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                autoComplete="off"
                placeholder="Search articles..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400 text-sm"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Featured: Getting Started Guide ──────────────────
         Promotes the printable customer guide right at the top.
         Anyone landing on /help cold should see this first. */}
      {!q && (
        <section className="pb-8">
          <div className="max-w-6xl mx-auto px-6">
            <Link
              href="/guide/getting-started"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-7 md:p-9 text-white shadow-xl shadow-indigo-500/20 hover:shadow-2xl hover:shadow-indigo-500/30 transition-all flex items-start md:items-center gap-5 md:gap-7 flex-col md:flex-row"
            >
              <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-inner">
                <FileText className="w-7 h-7 text-white" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 border border-white/20 text-[10px] font-bold tracking-wider uppercase mb-2">
                  <Sparkles className="w-3 h-3" />
                  Start here
                </div>
                <h2 className="font-[family-name:var(--font-fredoka)] text-xl md:text-2xl font-semibold leading-tight">
                  Getting Started Guide
                </h2>
                <p className="mt-1 text-sm md:text-[15px] text-white/85 leading-relaxed max-w-2xl">
                  A printable walk-through for new districts: pair a screen, upload content, build &amp; publish a playlist, set up emergency alerts, and pick a template along the way. Read on screen or save as PDF.
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 md:flex-col md:items-end">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-indigo-700 text-xs font-bold group-hover:translate-x-0.5 transition-transform">
                  Open guide
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
                <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-white/70 font-medium">
                  <Printer className="w-3 h-3" />
                  Print PDF available
                </span>
              </div>
            </Link>
          </div>
        </section>
      )}

      {!q && (
        <section className="pb-12">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold text-slate-900">
                Browse by category
              </h2>
              <span className="text-xs font-medium text-slate-500">{articles.length} articles</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {HELP_CATEGORIES.map((c) => {
                const count = articles.filter((a) => a.category === c.name).length;
                const first = articles.find((a) => a.category === c.name);
                return (
                  <Link
                    key={c.name}
                    href={first ? `/help/${first.slug}` : '/help'}
                    className="group rounded-2xl bg-white border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-start gap-4"
                  >
                    <div className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow-sm`}>
                      <BookOpen className="w-4.5 h-4.5 text-white" strokeWidth={2.25} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-[family-name:var(--font-fredoka)] text-base font-semibold text-slate-900 group-hover:text-indigo-700 transition">
                        {c.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-600 leading-relaxed line-clamp-2">{c.description}</p>
                      <p className="mt-2 text-[11px] font-semibold text-indigo-600 inline-flex items-center gap-1">
                        {count} {count === 1 ? 'article' : 'articles'}
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="pb-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold text-slate-900">
              {q ? `Results for "${q}"` : 'All articles'}
            </h2>
            <span className="text-xs font-medium text-slate-500">
              {filtered.length} {filtered.length === 1 ? 'article' : 'articles'}
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
              <p className="text-slate-600">No articles match that search.</p>
              <p className="mt-2 text-sm text-slate-500">
                Try a different term, or email{' '}
                <a className="text-indigo-600 underline" href="mailto:support@edusignage.app">
                  support@edusignage.app
                </a>
                .
              </p>
            </div>
          ) : q ? (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <ArticleCard key={a.slug} a={a} />
              ))}
            </ul>
          ) : (
            <div className="space-y-8">
              {Array.from(byCategory.entries()).map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="text-[10px] font-bold tracking-[0.14em] uppercase text-slate-500 mb-2.5">{cat}</h3>
                  <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {list.map((a) => (
                      <ArticleCard key={a.slug} a={a} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pb-16">
        <div className="max-w-3xl mx-auto px-6">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
              <Mail className="w-4.5 h-4.5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-[family-name:var(--font-fredoka)] text-base font-semibold text-slate-900">
                Can&apos;t find an answer?
              </h3>
              <p className="text-sm text-slate-600 mt-0.5">
                Email support and a human will get back within one school day.
              </p>
            </div>
            <a
              href="mailto:support@edusignage.app"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition flex-shrink-0"
            >
              Email support
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function ArticleCard({ a }: { a: HelpArticle }) {
  return (
    <li>
      <Link
        href={`/help/${a.slug}`}
        className="group block rounded-xl bg-white border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all h-full"
      >
        <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-indigo-600">{a.category}</p>
        <h4 className="mt-1 font-semibold text-slate-900 group-hover:text-indigo-700 transition text-sm">{a.title}</h4>
        <p className="mt-1 text-xs text-slate-600 line-clamp-2 leading-relaxed">{a.excerpt}</p>
      </Link>
    </li>
  );
}
