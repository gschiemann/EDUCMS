import { PublicShell } from '@/components/marketing/PublicShell';
import { HelpHub } from '@/components/help/HelpHub';
import { getAllArticles } from '@/content/help';

export const metadata = {
  title: 'Help center — VenueOS',
  description: 'Guides, how-tos, and answers for VenueOS admins, teachers, and district IT.',
};

export default function HelpPage() {
  const articles = getAllArticles();
  return (
    <PublicShell>
      <HelpHub articles={articles} />
    </PublicShell>
  );
}
