import { redirect } from 'next/navigation';

/**
 * /[schoolId]/settings/overview — PRESERVED OLD URL (2026-10-26). The
 * Overview page only repeated the menu, the emergency readiness card and the
 * activity log; its useful part is now the Settings home, so this URL goes
 * there (settings audit, Appendix A: "redirect to /settings").
 */
export default async function SettingsOverviewRedirect({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  redirect(`/${schoolId}/settings`);
}
