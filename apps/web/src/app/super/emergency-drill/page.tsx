'use client';

/**
 * /super/emergency-drill — the owner's permission for a test alert on the
 * bench screens (2026-11-10). Everything lives in EmergencyDrillPanel; the
 * super layout supplies the way back, the dialogs and the phone tab bar.
 */
import { EmergencyDrillPanel } from '@/components/super/EmergencyDrillPanel';

export default function EmergencyDrillPage() {
  return <EmergencyDrillPanel />;
}
