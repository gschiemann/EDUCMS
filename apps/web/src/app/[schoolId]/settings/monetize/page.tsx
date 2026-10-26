import { redirect } from 'next/navigation';

/**
 * Ad-network monetization is NOT a built integration (owner, 2026-10-12: a
 * customer asked and there was nothing real to show). Both
 * /settings/monetize and /settings/integrations/monetization stay as URLs
 * (API `configurePath` values point at them) and open Connections, the area
 * that lists what can really be connected today.
 */
export default async function MonetizeSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  redirect(`/${schoolId}/settings/integrations`);
}
