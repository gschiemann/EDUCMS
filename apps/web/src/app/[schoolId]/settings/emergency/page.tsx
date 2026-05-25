'use client';

/**
 * /[schoolId]/settings/emergency — dedicated emergency-content editor.
 *
 * Operator (2026-05-25 settings bug-bash): "when you enable emergency,
 * it creates another entirely new menu page instead of living in its
 * own page and it has these massive boxes to load the info taking up
 * way more space than it should… no need for that big ass drag and
 * drop area, slim this down all over."
 *
 * The full panic-content editor (the six SRP cards + the Sprint 8b
 * location-mode floor-plan workflow) used to render INLINE on the
 * main settings page whenever the operator clicked "Emergency On."
 * It pushed every other settings card off the screen and made the
 * main settings tab feel like the emergency menu.
 *
 * Now: the main settings page only carries the toggle row + a
 * "Configure →" link. The actual heavy editor lives here.
 *
 * Reuses the existing `PanicContentSection` component (still defined
 * in settings/page.tsx as the source of truth for the toggle +
 * editor + location mode glue) so there's no duplicated logic.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertOctagon, ArrowLeft } from 'lucide-react';
import { PanicContentSection } from '../page';
import { RoleGate } from '@/components/RoleGate';

export default function EmergencySettingsPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div>
        <Link
          href={`/${schoolId}/settings`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Settings
        </Link>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <AlertOctagon className="w-6 h-6 text-rose-500" />
          Emergency content
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          The content that plays on every screen when an emergency is
          triggered. Six SRP types (Lockdown / Evacuate / Medical / Secure /
          Shelter / Hold) — upload landscape + portrait variants per type.
        </p>
      </div>

      <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}>
        <PanicContentSection />
      </RoleGate>
    </div>
  );
}
