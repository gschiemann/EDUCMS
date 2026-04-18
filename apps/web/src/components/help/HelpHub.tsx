'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight, BookOpen, Mail } from 'lucide-react';
import { HELP_CATEGORIES, type HelpArticle, type HelpCategory } from '@/content/help/types';

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
      <section className="pt-16 pb-12">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium text-slate-600 mb-6">
            <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
            Help center
          </div>
          <h1 className="font-[family-name:var(--font-fredoka)] text-5xl md:text-6xl font-semibold tracking-tight text-slate-900">
            How can we
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent"> help</span>?
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Guides, how-tos, and answers — written for teachers, techs, and district admins.
          </p>

          <div className="mt-10 relative max-w-xl mx-auto">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="search"
              autoComplete="off"
              placeholder="Search articles..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-14 pr-5 py-4 rounded-2xl bg-white border border-slate-200 shadow-lg shadow-indigo-500/5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
            />
          </div>
        </div>
      </section>

      {!q && (
        <section className="pb-16">
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="font-[family-name:var(--font-fredoka)] text-2xl font-semibold text-slate-900 mb-6">
              Browse by category
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {HELP_CATEGORIES.map((c) => {
                const count = articles.filter((a) => a.category === c.name).length;
                const first = articles.find((a) => a.category === c.name);
                return (
                  <Link
                    key={c.name}
                    href={first ? `/help/${first.slug}` : '/help'}
                    className="group rounded-3xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all"
                  >
                    <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow-lg`}>
                      <BookOpen className="w-5 h-5 text-white" strokeWidth={2.25} />
                    </div>
                    <h3 className="mt-4 font-[family-name:var(--font-fredoka)] text-lg font-semibold text-slate-900">
                      {c.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 leading-relaxed">{c.description}</p>
                    <p className="mt-4 text-xs font-medium text-indigo-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1.5">
                      {count} {count === 1 ? 'article' : 'articles'} <ArrowRight className="w-3 h-3" />
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="pb-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="font-[family-name:var(--font-fredoka)] text-2xl font-semibold text-slate-900 mb-6">
            {q ? `Results for "${q}" (${filtered.length})` : 'All articles'}
          </h2>
          {filtered.length === 0 ? (
            <div className="rounded-3xl bg-white border border-slate-200 p-10 text-center">
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
            <ul className="grid gap-3 md:grid-cols-2">
              {filtered.map((a) => (
                <ArticleCard key={a.slug} a={a} />
              ))}
            </ul>
          ) : (
            <div className="space-y-10">
              {Array.from(byCategory.entries()).map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3">{cat}</h3>
                  <ul className="grid gap-3 md:grid-cols-2">
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

      <section className="pb-20">
        <div className="max-w-3xl mx-auto px-6">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 p-8 flex flex-col md:flex-row items-start md:items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-md">
              <Mail className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900">
                Can&apos;t find an answer?
              </h3>
              <p className="text-sm text-slate-600">
                Email our support team and a human will get back to you within one school day.
              </p>
            </div>
            <a
              href="mailto:support@edusignage.app"
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition"
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
        className="group block rounded-2xl bg-white border border-slate-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all h-full"
      >
        <p className="text-[10px] font-bold tracking-wider uppercase text-indigo-500">{a.category}</p>
        <h4 className="mt-1 font-semibold text-slate-900 group-hover:text-indigo-700 transition">{a.title}</h4>
        <p className="mt-1.5 text-sm text-slate-600 line-clamp-2">{a.excerpt}</p>
      </Link>
    </li>
  );
}
