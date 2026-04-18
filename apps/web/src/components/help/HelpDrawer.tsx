'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, X, Search, ExternalLink, Mail, ArrowLeft, Loader2 } from 'lucide-react';
import type { HelpArticle } from '@/content/help/types';
import { Markdown } from './Markdown';

export function HelpDrawer() {
  const [open, setOpen] = useState(false);
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [q, setQ] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

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

  const active = articles && activeSlug ? articles.find((a) => a.slug === activeSlug) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 hover:text-indigo-600 transition-all"
        title="Help and documentation"
        aria-label="Open help"
      >
        <HelpCircle className="w-4.5 h-4.5" strokeWidth={2} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Help">
          <button
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          />
          <aside className="relative w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <header className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {active && (
                  <button
                    onClick={() => setActiveSlug(null)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"
                    aria-label="Back to article list"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="font-[family-name:var(--font-fredoka)] text-lg font-semibold text-slate-900 truncate">
                  {active ? active.title : 'Help'}
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"
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
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="text-[10px] font-bold tracking-wider uppercase text-indigo-500 mb-1">
                  {active.category}
                </div>
                {active.excerpt && (
                  <p className="text-sm text-slate-600 mb-5 leading-relaxed">{active.excerpt}</p>
                )}
                <Markdown source={stripTitle(active.body)} />
                <div className="mt-8 pt-5 border-t border-slate-100">
                  <Link
                    href={`/help/${active.slug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-500"
                  >
                    Open in full help center <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="search"
                      placeholder="Search articles..."
                      autoComplete="off"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-slate-500 px-3 py-10 text-center">No articles match that search.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filtered.map((a) => (
                        <li key={a.slug}>
                          <button
                            onClick={() => setActiveSlug(a.slug)}
                            className="w-full text-left px-3 py-3 rounded-xl hover:bg-slate-50 transition group"
                          >
                            <p className="text-[10px] font-bold tracking-wider uppercase text-indigo-500">
                              {a.category}
                            </p>
                            <p className="mt-0.5 text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                              {a.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{a.excerpt}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <footer className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
                  <Link
                    href="/help"
                    target="_blank"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 inline-flex items-center gap-1.5"
                  >
                    Full help center <ExternalLink className="w-3 h-3" />
                  </Link>
                  <a
                    href="mailto:support@edusignage.app"
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
                  >
                    <Mail className="w-3 h-3" /> Contact support
                  </a>
                </footer>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function stripTitle(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
