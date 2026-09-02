"use client";

/**
 * /[schoolId]/settings/overview — Settings Overview (§7.1).
 *
 * The route is a thin mount so the editor itself stays testable without a
 * Next router; everything lives in the component.
 */
import { SettingsOverviewPage } from '@/components/settings/cc/OverviewPage';

export default function Page() {
  return <SettingsOverviewPage />;
}
