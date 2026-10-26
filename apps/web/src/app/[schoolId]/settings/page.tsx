"use client";

/**
 * /[schoolId]/settings — the Settings home (Phase 1 simplification,
 * 2026-10-26): search, what needs attention, the six areas, Activity and
 * My account — on every screen size. It replaces the desktop redirect to
 * /settings/overview and the phone-only index.
 */
import { SettingsHome } from '@/components/settings/home/SettingsHome';

export default function SettingsIndexPage() {
  return <SettingsHome />;
}
