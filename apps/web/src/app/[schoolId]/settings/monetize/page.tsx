import { redirect } from 'next/navigation';

/**
 * Ad-network monetization is NOT a built integration (owner, 2026-10-12: a
 * customer asked and there was nothing real to show). The admin view is kept
 * in MonetizeSettingsView.tsx for when a real ad network is wired; until then
 * both /settings/monetize and /settings/integrations/monetization send the
 * operator to Settings instead of a page that looks finished but is not.
 */
export default async function MonetizeSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  redirect(`/${schoolId}/settings`);
}
