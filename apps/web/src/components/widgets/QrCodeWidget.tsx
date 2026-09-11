'use client';

/**
 * QR_CODE + WIFI_GUEST_ACCESS — a real, scannable code on any board.
 *
 * ── WHY THIS DID NOT EXIST (2026-09-11) ───────────────────────────────
 * Six parallel market lenses put a generic QR block at the top of the gap
 * list: Yodeck and OptiSigns both ship one, and it is the only widget on that
 * list that serves all ten of our verticals — K-12 permission forms and lunch
 * accounts, worship giving, healthcare check-in, corporate visitor forms,
 * hospitality menus, retail promos, restaurant ordering.
 *
 * We already had the pieces and had never joined them. `qrcode@1.5.4` is a
 * dependency, used in the dashboard (screen pairing, the sports share link,
 * login) — but in NO widget. And the one widget with "QR" in its name,
 * `RetailLoyaltyQRWidget`, draws a DECORATIVE SVG pattern that is not
 * scannable at all unless the operator separately generates a code elsewhere
 * and pastes its image URL. So an operator could not put a working QR on a
 * board in any vertical.
 *
 * ── CLIENT-SIDE ON PURPOSE ────────────────────────────────────────────
 * The code is generated in the browser from the `qrcode` lib, not fetched.
 * A signage player spends its life offline or behind a captive portal, and a
 * QR that 404s is a blank white square on a wall. Generating locally also
 * means the payload — a wifi password, a staff phone number — never leaves
 * the device.
 *
 * ── TAURUS / CHROMIUM-83 ──────────────────────────────────────────────
 * No container-query units (this file adds none to the taurus-safety
 * baseline), no flex `gap`, no `inset` shorthand, no `backdrop-filter`.
 * Scaling rides `withMeasuredHeight`, the same ResizeObserver path the v2
 * pack uses, so every size is a plain px number computed in JS.
 */

import { useEffect, useState } from 'react';
import { WidgetEmptyState } from './WidgetEmptyState';
import { buildQrPayload, defaultQrCaption, type QrPayloadConfig } from './qr-payload';

export interface QrCodeConfig extends QrPayloadConfig {
  title?: string;
  caption?: string;
  /** Foreground/background of the code itself. Contrast is enforced below. */
  darkColor?: string;
  lightColor?: string;
  /** Page background behind the whole widget. */
  bgColor?: string;
  textColor?: string;
  /** 0-40% of the shorter edge. Bigger code = scannable from further away. */
  codeScale?: number;
  showTitle?: boolean;
}

/**
 * A QR needs a light quiet zone and high contrast to scan. An operator who
 * sets a dark-on-dark brand palette produces a code that looks on-brand in the
 * builder and is unscannable on the wall — so the RENDERED code always keeps a
 * light field, and brand colour is applied to the surrounding card instead.
 * This is deliberately not configurable away.
 */
const SAFE_LIGHT = '#ffffff';

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

export function QrCodeWidget({
  config,
  height = 480,
}: {
  config: QrCodeConfig;
  height?: number;
  compact?: boolean;
  live?: boolean;
}) {
  const c = config || {};
  const payload = buildQrPayload(c);
  const [dataUrl, setDataUrl] = useState<string>('');
  const [failed, setFailed] = useState(false);

  // The requested dark colour is only honoured if it will actually scan
  // against the forced-light field.
  const dark = c.darkColor && isDark(c.darkColor) ? c.darkColor : '#000000';

  useEffect(() => {
    if (!payload) { setDataUrl(''); setFailed(false); return; }
    let alive = true;
    setFailed(false);
    // Dynamic import: `qrcode` is ~50KB and only this widget needs it, so it
    // must not ride in the shared widget chunk every board pays for.
    import('qrcode')
      .then((m) => (m.default || m).toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,               // the quiet zone; below 2 modules scanners struggle
        width: 1024,             // generated once, scaled by CSS — crisp at 4K
        color: { dark, light: SAFE_LIGHT },
      }))
      .then((url: string) => { if (alive) setDataUrl(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [payload, dark]);

  if (!payload) {
    return (
      <WidgetEmptyState
        eyebrow={c.mode === 'wifi' ? 'GUEST WIFI' : 'QR CODE'}
        action={c.mode === 'wifi' ? 'Add your network name' : 'Add a link to share'}
        hint="Properties → what should this code do?"
        accent={c.darkColor}
        tone={isDark(c.bgColor || '#0b0b10') ? 'dark' : 'light'}
      />
    );
  }

  const bg = c.bgColor || '#0b0b10';
  const onBg = c.textColor || (isDark(bg) ? '#f8fafc' : '#111827');
  const muted = isDark(bg) ? 'rgba(248,250,252,0.62)' : 'rgba(17,24,39,0.6)';

  const title = (c.title || '').trim();
  const showTitle = c.showTitle !== false && !!title;
  const caption = (c.caption ?? '').trim() || defaultQrCaption(c);

  // Everything sizes off the measured box, so there are no cq units and no
  // px ceiling that could pin the type small on a 4K wall — the fault class
  // that made 231 widgets unreadable (see check-font-ceilings.cjs).
  const pct = Math.min(40, Math.max(12, c.codeScale ?? 26));
  const codePx = Math.round(height * (pct / 100) * 2.2);
  const titlePx = Math.round(height * 0.085);
  const capPx = Math.round(height * 0.05);
  const pad = Math.round(height * 0.06);
  const quiet = Math.round(codePx * 0.045);

  return (
    <div
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        overflow: 'hidden', background: bg, color: onBg,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: pad,
        fontFamily: "'Inter', system-ui, sans-serif",
        textAlign: 'center',
      }}
    >
      {showTitle && (
        <div
          data-field="title"
          style={{
            fontSize: titlePx, fontWeight: 800, lineHeight: 1.1,
            letterSpacing: '-0.01em', marginBottom: Math.round(height * 0.035),
            maxWidth: '92%',
          }}
        >
          {title}
        </div>
      )}

      {failed ? (
        // Say what is true. A blank square on a wall with no explanation is
        // the failure mode this whole widget exists to avoid.
        <div style={{ fontSize: capPx, color: muted, maxWidth: '80%' }}>
          This code could not be generated — the content may be too long to fit a QR.
        </div>
      ) : (
        <div
          style={{
            background: SAFE_LIGHT,
            padding: quiet,
            borderRadius: Math.round(codePx * 0.03),
            lineHeight: 0,
          }}
        >
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={c.mode === 'wifi' ? `Wi-Fi join code for ${c.ssid || 'the guest network'}` : `QR code for ${caption || 'this board'}`}
              width={codePx}
              height={codePx}
              style={{ display: 'block', width: codePx, height: codePx, imageRendering: 'pixelated' }}
            />
          ) : (
            <div style={{ width: codePx, height: codePx }} />
          )}
        </div>
      )}

      {c.mode === 'wifi' && (c.ssid || '').trim() && (
        <div style={{ marginTop: Math.round(height * 0.035) }}>
          <div style={{ fontSize: capPx, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Network
          </div>
          <div data-field="ssid" style={{ fontSize: Math.round(capPx * 1.5), fontWeight: 700, lineHeight: 1.2 }}>
            {c.ssid}
          </div>
          {c.encryption !== 'nopass' && (c.password || '').trim() && (
            <div
              data-field="password"
              style={{ fontSize: Math.round(capPx * 1.2), fontWeight: 600, color: muted, marginTop: Math.round(height * 0.012), fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
            >
              {c.password}
            </div>
          )}
        </div>
      )}

      {c.mode !== 'wifi' && caption && (
        <div
          data-field="caption"
          style={{ marginTop: Math.round(height * 0.035), fontSize: capPx, color: muted, maxWidth: '92%', wordBreak: 'break-word' }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
