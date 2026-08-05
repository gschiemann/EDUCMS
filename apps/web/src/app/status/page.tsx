import { PublicShell } from '@/components/marketing/PublicShell';
import { StatusBoard } from './StatusBoard';

export const metadata = {
  title: 'System Status — VenueOS',
  description:
    'Live operational status for the VenueOS platform: API, database, realtime delivery, emergency alert path, and file storage.',
};

/**
 * Public status page (2026-08-05) — the customer-facing monitoring surface
 * every major signage platform ships (status.yodeck.com et al.).
 *
 * Architecture note: this page is served by Vercel while the API runs on
 * Railway — two independent deploy surfaces. When the API is down, this page
 * still loads and shows it red; the in-app PlatformHealthMonitorService and
 * the keep-warm GitHub Action cover the alerting side. Live checks only, no
 * stored history — the health endpoints are the single source of truth.
 */
export default function StatusPage() {
  return (
    <PublicShell>
      <StatusBoard />
    </PublicShell>
  );
}
