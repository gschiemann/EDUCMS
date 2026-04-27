"use client";

/**
 * Single floor plan editor — Sprint 8b Phase 1.
 *
 * Thin page wrapper now (2026-04-27). All the editor logic lives in the
 * reusable <EmbeddedFloorPlanView /> component so Settings can mount the
 * exact same UX inline when location-based mode is on.
 */

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/RoleGate';
import { EmbeddedFloorPlanView } from '@/components/floor-plans/EmbeddedFloorPlanView';

export default function FloorPlanDetailPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER']}
      fallback={<div className="text-center py-24 text-sm text-slate-500">No access.</div>}
    >
      <FloorPlanDetailRoute />
    </RoleGate>
  );
}

function FloorPlanDetailRoute() {
  const params = useParams<{ schoolId: string; id: string }>();
  const id = params?.id ?? '';
  const schoolId = params?.schoolId ?? '';
  return <EmbeddedFloorPlanView planId={id} schoolId={schoolId} mode="standalone" />;
}
