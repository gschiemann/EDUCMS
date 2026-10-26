import { redirect } from 'next/navigation';

/**
 * /[schoolId]/settings/test-integrations — PRESERVED OLD URL (2026-10-26).
 * The staff-only integration test tool moved to the owner console
 * (/super/test-integrations, SUPER_ADMIN only); bookmarks land there.
 */
export default function TestIntegrationsMovedPage() {
  redirect('/super/test-integrations');
}
