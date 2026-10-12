import { redirect } from 'next/navigation';

/**
 * Announcements are published with the Announcement widget inside a template
 * and scheduled through Playlists, so this stand-alone route has no page of
 * its own. It stays as a redirect for old bookmarks.
 */
export default async function AnnouncementsRedirect({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  redirect(`/${encodeURIComponent(schoolId)}/playlists`);
}
