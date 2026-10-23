import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Calendar, Tag } from 'lucide-react';
import { Markdown } from '@/components/help/Markdown';
import { LocaleVariant, PublicT } from '@/components/marketing/PublicText';
import { HELP_CATEGORY_KEY, type HelpArticle } from '@/content/help/types';

/**
 * One help article — a SERVER component. An article that ships translations
 * (`<slug>.es.md` / `<slug>.zh.md`) is rendered on the server once per
 * language and `LocaleVariant` shows the reader's; the Markdown renderer and
 * the article text never become client JavaScript (bundle budget).
 */
export function HelpArticleView({ article, related }: { article: HelpArticle; related: HelpArticle[] }) {
  const catKey = `help.categories.${HELP_CATEGORY_KEY[article.category]}.name`;
  const tr = article.translations;
  const variants = (render: (t: { title: string; excerpt: string; body: string }) => ReactNode) => (
    <LocaleVariant
      en={render(article)}
      es={tr?.es ? render(tr.es) : undefined}
      zh={tr?.zh ? render(tr.zh) : undefined}
    />
  );

  return (
    <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <PublicT k="help.back" />
      </Link>

      <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
          <Tag className="w-3 h-3" />
          <PublicT k={catKey} />
        </span>
        {article.updated && (
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Calendar className="w-3 h-3" />
            <PublicT k="help.updated" values={{ date: article.updated }} />
          </span>
        )}
      </div>

      {variants((t) => (
        <>
          <h1 className="mt-4 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
            {t.title}
          </h1>
          {t.excerpt && <p className="mt-4 text-lg text-slate-600 leading-relaxed">{t.excerpt}</p>}

          <hr className="my-10 border-slate-200" />

          <Markdown source={stripTitle(t.body)} />
        </>
      ))}

      {related.length > 0 && (
        <section className="mt-16 pt-10 border-t border-slate-200">
          <h2 className="font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900 mb-5">
            <PublicT k="help.moreIn" valueKeys={{ category: catKey }} />
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {related.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/help/${a.slug}`}
                  className="block rounded-2xl bg-white border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition"
                >
                  <LocaleVariant
                    en={<RelatedText t={a} />}
                    es={a.translations?.es ? <RelatedText t={a.translations.es} /> : undefined}
                    zh={a.translations?.zh ? <RelatedText t={a.translations.zh} /> : undefined}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function RelatedText({ t }: { t: { title: string; excerpt: string } }) {
  return (
    <>
      <p className="font-semibold text-slate-900">{t.title}</p>
      <p className="mt-1 text-sm text-slate-600 line-clamp-2">{t.excerpt}</p>
    </>
  );
}

// The .md files often start with a level-1 heading identical to the frontmatter title.
// The title is rendered separately above, so strip that leading # line to avoid duplication.
function stripTitle(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
