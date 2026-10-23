import { notFound } from 'next/navigation';
import { PublicShell } from '@/components/marketing/PublicShell';
import { HelpArticleView } from '@/components/help/HelpArticleView';
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
  if (!article) return { title: 'Article not found — VenueOS' };
  return {
    title: `${article.title} — VenueOS help`,
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
      <HelpArticleView article={article} related={related} />
    </PublicShell>
  );
}
