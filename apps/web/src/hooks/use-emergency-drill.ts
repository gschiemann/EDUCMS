"use client";

/**
 * Is the emergency on screen right now a DRILL? (2026-10-24, launch QA U16)
 *
 * For the always-mounted chrome — the phone header pill and status strip, the
 * Sidebar pill, the dashboard card, the sports console — which used to print
 * live-emergency words ("CRITICAL ACTIVE", "ACTIVE EMERGENCY") during a
 * practice drill.
 *
 * It runs NO query of its own (mobile-perf rule 4: no new work in the chrome).
 * It reads what is already there:
 *   1. the answer EmergencyOverlay publishes to the store from the live alert
 *      list it already reads (`emergencyDrillOnly`) — this is what covers a
 *      drill aimed at one group or one screen;
 *   2. otherwise the tenant row's own `emergencyIsDrill`, from the tenant
 *      status read every dashboard page already shares.
 *
 * Wording only: nothing that sends, delivers, clears or audits an alert.
 */
import { useAppStore } from '@/lib/store';
import { useTenantStatus } from '@/hooks/use-api';

export function useEmergencyDrillOnly(): boolean {
  const published = useAppStore((s) => s.emergencyDrillOnly);
  const { data: tenant } = useTenantStatus();
  if (typeof published === 'boolean') return published;
  return (tenant as { emergencyIsDrill?: boolean } | undefined)?.emergencyIsDrill === true;
}
