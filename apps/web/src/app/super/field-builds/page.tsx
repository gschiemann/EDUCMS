'use client';

/**
 * /super/field-builds — arm, cancel and push private field builds of the
 * player (2026-10-18). Everything lives in FieldBuildsPanel; the super layout
 * supplies the way back, the dialogs and the phone tab bar.
 */
import { FieldBuildsPanel } from '@/components/screens/FieldBuildsPanel';

export default function FieldBuildsPage() {
  return <FieldBuildsPanel />;
}
