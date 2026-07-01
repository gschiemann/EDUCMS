"use client";

/**
 * App Library visual isolation test — DEV ONLY.
 *
 * Mirrors the pattern in demo/zone-test/page.tsx: mount the ACTUAL panel
 * component (not a mock) with no auth/DB dependency, so the Apps tab can be
 * verified end-to-end (card grid -> config form -> live preview -> "Add to
 * canvas" -> zone appears in useBuilderStore) without needing a live
 * backend. Useful for future manual QA on this feature too.
 */

import { AppLibraryPanel } from '@/components/apps/AppLibraryPanel';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';

export default function AppLibraryDemoPage() {
  const zones = useBuilderStore((s) => s.zones);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: 32, color: '#fff', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', gap: 24 }}>
      <div style={{ width: 420, height: 760, background: '#fff', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
        <AppLibraryPanel />
      </div>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Zones added via the App Library ({zones.length})</h1>
        <pre style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', background: '#1e293b', padding: 16, borderRadius: 8 }}>
          {JSON.stringify(zones.map((z) => ({ widgetType: z.widgetType, defaultConfig: z.defaultConfig })), null, 2)}
        </pre>
      </div>
    </div>
  );
}
