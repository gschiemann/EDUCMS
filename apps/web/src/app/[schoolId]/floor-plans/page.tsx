"use client";

/**
 * Floor plans list — Sprint 8b Phase 1.
 *
 * Operator lands here from a direct link or from the Screens page
 * "Floor plans" tab. Sees every floor plan in their tenant, can
 * upload a new PNG/JPG of a building floor, and clicks into a single
 * plan to drop screen pins on it.
 *
 * 2026-05-14 — the heavy lifting (grid, upload modal, RBAC, delete
 * flow) moved to `components/screens/FloorPlansView.tsx` so the
 * Screens page tab system can render the SAME content inline. This
 * page is now a thin route wrapper that just imposes the RoleGate
 * and lets FloorPlansView do its full standalone-page render.
 */

import { RoleGate } from '@/components/RoleGate';
import { FloorPlansView } from '@/components/screens/FloorPlansView';

export default function FloorPlansPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER']}
      fallback={<div className="text-center py-24 text-sm text-slate-500">You don&rsquo;t have permission to view floor plans.</div>}
    >
      <FloorPlansView />
    </RoleGate>
  );
}
