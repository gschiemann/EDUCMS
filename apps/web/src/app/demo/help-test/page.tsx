"use client";

/**
 * Help drawer isolation test — DEV ONLY.
 *
 * Mounts the HelpDrawer on a colorful page so we can verify the
 * panel is opaque + correctly sized + doesn't let the page
 * background bleed through. Created to debug the partner's
 * "still just this?" report where the drawer body was rendering
 * transparent.
 */

import { HelpDrawer } from '@/components/help/HelpDrawer';

export default function HelpTestPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        // Match the same gradient hero the partner had behind the
        // drawer — orange → pink → purple. If the drawer panel is
        // properly opaque, this gradient should be HIDDEN where the
        // panel sits. If it's not, we'll see the gradient bleed
        // through, exactly reproducing the bug.
        background: 'linear-gradient(135deg, #f97316 0%, #ec4899 50%, #a855f7 100%)',
        padding: 32,
        color: '#fff',
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 16 }}>
        Help Drawer Isolation Test
      </h1>
      <p style={{ marginBottom: 24, fontSize: 14, lineHeight: 1.6, maxWidth: 600 }}>
        Click the help icon (top-right) to open the drawer. The panel
        should appear as a fully opaque white floating popover on the
        right edge — this gradient should NOT bleed through it.
      </p>
      <button
        type="button"
        style={{
          background: '#fff',
          color: '#0f172a',
          padding: '8px 16px',
          borderRadius: 999,
          fontWeight: 600,
        }}
      >
        + New Template
      </button>
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50 }}>
        <HelpDrawer />
      </div>
    </div>
  );
}
