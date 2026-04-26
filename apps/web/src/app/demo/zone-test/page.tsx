"use client";

/**
 * BuilderZone visual isolation test — DEV ONLY.
 *
 * Mounts the ACTUAL widgets (not just the BuilderZone wrapper) so we
 * can verify what a freshly-dropped zone really looks like end-to-end.
 * Partner kept reporting "transparent box" — this confirms whether
 * the widget renders correctly inside the wrapper styling.
 */

import { Type, Image as ImageIcon, Globe, Megaphone, Clock } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

const ZONES: Array<{ type: string; label: string; accent: string; config: any }> = [
  { type: 'CLOCK',        label: 'CLOCK',         accent: '#6b7280', config: {} },
  { type: 'TEXT',         label: 'TEXT',          accent: '#64748b', config: { content: 'Click to edit text' } },
  { type: 'WEATHER',      label: 'WEATHER',       accent: '#06b6d4', config: {} },
  { type: 'ANNOUNCEMENT', label: 'ANNOUNCEMENT',  accent: '#f59e0b', config: { message: 'Click to edit announcement' } },
  { type: 'TICKER',       label: 'TICKER',        accent: '#f59e0b', config: { messages: ['Click to edit ticker'] } },
  { type: 'WEBPAGE',      label: 'URL / WEBSITE', accent: '#10b981', config: { url: 'https://example.com' } },
  { type: 'IMAGE',        label: 'IMAGE (empty)', accent: '#3b82f6', config: {} },
  { type: 'COUNTDOWN',    label: 'COUNTDOWN',     accent: '#f43f5e', config: { title: 'Countdown' } },
];

const ICONS: Record<string, any> = {
  TEXT: Type, IMAGE: ImageIcon, WEBPAGE: Globe, ANNOUNCEMENT: Megaphone, CLOCK: Clock,
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
      <div style={{ background: 'linear-gradient(to bottom right, #f1f5f9, #e2e8f0)', padding: 32, borderRadius: 12, position: 'relative', minHeight: 900 }}>
        {ZONES.map((z, i) => {
          const Icon = ICONS[z.type] ?? Type;
          // Stack 4 zones per row in a 4×2 grid
          const col = i % 4;
          const row = Math.floor(i / 4);
          return (
            <div
              key={z.type}
              style={{
                position: 'absolute',
                left: `${4 + col * 24}%`,
                top: `${4 + row * 48}%`,
                width: '22%',
                height: '40%',
                background: '#ffffff',
                border: `3px solid ${z.accent}`,
                boxShadow: `0 4px 12px ${z.accent}33`,
                overflow: 'hidden',
              }}
            >
              {/* Actual widget render — same path BuilderZone uses */}
              <WidgetPreview widgetType={z.type} config={z.config} width={22} height={40} live={false} />

              {/* Label badge — exact same as BuilderZone */}
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
                  zIndex: 30,
                  pointerEvents: 'none',
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
