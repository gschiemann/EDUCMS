import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Calendar, Tag } from 'lucide-react';
import { PublicShell } from '@/components/marketing/PublicShell';
import { Markdown } from '@/components/help/Markdown';
import { getAllArticles, getArticle } from '@/content/help';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: 'Article not found — EduSignage' };
  return {
    title: `${article.title} — EduSignage help`,
    description: article.excerpt,
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const related = getAllArticles()
    .filter((a) => a.category === article.category && a.slug !== article.slug)
    .slice(0, 4);

  return (
    <PublicShell>
      <article className="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <Link
          href="/help"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to help center
        </Link>

        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
            <Tag className="w-3 h-3" />
            {article.category}
          </span>
          {article.updated && (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <Calendar className="w-3 h-3" />
              Updated {article.updated}
            </span>
          )}
        </div>

        <h1 className="mt-4 font-[family-name:var(--font-fredoka)] text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
          {article.title}
        </h1>
        {article.excerpt && (
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">{article.excerpt}</p>
        )}

        <hr className="my-10 border-slate-200" />

        <Markdown source={stripTitle(article.body)} />

        {related.length > 0 && (
          <section className="mt-16 pt-10 border-t border-slate-200">
            <h2 className="font-[family-name:var(--font-fredoka)] text-xl font-semibold text-slate-900 mb-5">
              More in {article.category}
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/help/${a.slug}`}
                    className="block rounded-2xl bg-white border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition"
                  >
                    <p className="font-semibold text-slate-900">{a.title}</p>
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{a.excerpt}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </PublicShell>
  );
}

// The .md files often start with a level-1 heading identical to the frontmatter title.
// We render the title separately above, so strip that leading # line to avoid duplication.
function stripTitle(body: string): string {
  return body.replace(/^#\s+[^\n]+\n+/, '');
}
