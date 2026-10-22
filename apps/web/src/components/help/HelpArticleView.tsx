'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Calendar, Tag } from 'lucide-react';
import { Markdown } from '@/components/help/Markdown';
import type { HelpArticle } from '@/content/help/types';
import { HELP_CATEGORY_KEY, localizeArticle, useHelpLocale } from './localized-help';

/**
 * One help article. Client component (2026-10-22) so an article that ships a
 * translation (`<slug>.es.md` / `<slug>.zh.md`) shows it in the reader's
 * language; everything else renders exactly as before.
 */
export function HelpArticleView({ article, related }: { article: HelpArticle; related: HelpArticle[] }) {
  const t = useTranslations('publicSite.help');
  const locale = useHelpLocale();
  const text = localizeArticle(article, locale);
  const category = t(`categories.${HELP_CATEGORY_KEY[article.category]}.name`);

  return (
    <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('back')}
      </Link>

      <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
          <Tag className="w-3 h-3" />
          {category}
        </span>
        {article.updated && (
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Calendar className="w-3 h-3" />
            {t('updated', { date: article.updated })}
          </span>
        )}
      </div>

      <h1 className="mt-4 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
        {text.title}
      </h1>
      {text.excerpt && <p className="mt-4 text-lg text-slate-600 leading-relaxed">{text.excerpt}</p>}

      <hr className="my-10 border-slate-200" />

      <Markdown source={stripTitle(text.body)} />

      {related.length > 0 && (
        <section className="mt-16 pt-10 border-t border-slate-200">
          <h2 className="font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900 mb-5">
            {t('moreIn', { category })}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {related.map((a) => {
              const r = localizeArticle(a, locale);
              return (
                <li key={a.slug}>
                  <Link
                    href={`/help/${a.slug}`}
                    className="block rounded-2xl bg-white border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition"
                  >
                    <p className="font-semibold text-slate-900">{r.title}</p>
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{r.excerpt}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}

// The .md files often start with a level-1 heading identical to the frontmatter title.
// The title is rendered separately above, so strip that leading # line to avoid duplication.
function stripTitle(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
