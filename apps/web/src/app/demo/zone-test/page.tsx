"use client";

/**
 * BuilderZone visual isolation test — DEV ONLY.
 *
 * Renders a freshly-dropped (empty) zone with the exact CSS
 * BuilderZone applies, on a representative grey "canvas" background.
 * If this looks like an unmistakable colored rectangle with a label
 * badge, the partner's "transparent box" symptom is fixed.
 */

import { Type, Image as ImageIcon, Globe, Megaphone } from 'lucide-react';

const ZONES = [
  { type: 'TEXT',         label: 'TEXT',         accent: '#64748b' },
  { type: 'IMAGE',        label: 'IMAGE',        accent: '#3b82f6' },
  { type: 'WEBPAGE',      label: 'URL / WEBSITE', accent: '#10b981' },
  { type: 'ANNOUNCEMENT', label: 'ANNOUNCEMENT', accent: '#f59e0b' },
];

const ICONS: Record<string, any> = {
  TEXT: Type, IMAGE: ImageIcon, WEBPAGE: Globe, ANNOUNCEMENT: Megaphone,
};

export default function ZoneTestPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: 32, color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>BuilderZone Visual Test</h1>
      <p style={{ color: '#94a3b8', marginBottom: 24, fontSize: 14 }}>
        Each rectangle below is a freshly-dropped empty zone (no widget
        content yet). They should ALL be unmistakably visible — solid
        white interior, 3px colored border, drop shadow, label badge in
        the top-left.
      </p>
      <div style={{ background: 'linear-gradient(to bottom right, #f1f5f9, #e2e8f0)', padding: 32, borderRadius: 12, position: 'relative', minHeight: 600 }}>
        {ZONES.map((z, i) => {
          const Icon = ICONS[z.type];
          return (
            <div
              key={z.type}
              style={{
                position: 'absolute',
                left: `${5 + i * 22}%`,
                top: `${10 + i * 15}%`,
                width: '20%',
                height: '25%',
                background: '#ffffff',
                border: `3px solid ${z.accent}`,
                boxShadow: `0 4px 12px ${z.accent}33`,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  background: '#ffffff',
                  color: z.accent,
                  border: `1px solid ${z.accent}`,
                }}
              >
                <Icon style={{ width: 10, height: 10 }} />
                {z.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
