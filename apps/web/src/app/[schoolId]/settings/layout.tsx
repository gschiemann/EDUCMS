"use client";

/**
 * /[schoolId]/settings/* — Settings Command Center shell (2026-09-01).
 *
 * Every settings route renders inside the shared shell: registry-driven
 * index, page header contract, context rail, dirty guard, ⌘K palette.
 * Design: scratch/design/settings-page/SETTINGS-COMMAND-CENTER-V2-DESIGN-DEV-HANDOFF.md
 */
import { SettingsShellProvider } from '@/components/settings/shell/SettingsShellContext';
import { SettingsShell } from '@/components/settings/shell/SettingsShell';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsShellProvider>
      <SettingsShell>{children}</SettingsShell>
    </SettingsShellProvider>
  );
}
