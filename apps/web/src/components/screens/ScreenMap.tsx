"use client";

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MonitorPlay, AlertTriangle, ShieldCheck, Wifi, WifiOff, Clock } from 'lucide-react';

/**
 * Sprint 8 — fleet map view. Renders one pin per geo-located screen,
 * status-coded so a district admin instantly spots offline / no-cache
 * / emergency-active displays across 100+ screens.
 *
 * Dropped from v1 (queued):
 *   - leaflet.markercluster (3rd dep; not needed under ~200 screens)
 *   - heat-map mode for SUPER_ADMIN cross-tenant view
 *   - geo-scoped emergency triggers (lasso → trigger)
 *   - bulk multi-select operations
 */

export type ScreenForMap = {
  id: string;
  name: string;
  status: string;
  // Effective coords used for plotting. The API hydrates these from the
  // screen's own lat/lng first, then falls back to the tenant's
  // building location. geoSource tells the popup whether to badge it
  // as a building-level pin vs a precise per-screen pin.
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  geoSource?: 'screen' | 'tenant' | 'none';
  lastPingAt?: string | null;
  lastCacheReport?: { emergency?: { count?: number; bytes?: number } } | null;
};

type StatusKey = 'EMERGENCY' | 'ONLINE_READY' | 'ONLINE_NO_CACHE' | 'STALE' | 'OFFLINE' | 'PENDING';

function classifyScreen(s: ScreenForMap, emergencyActive: boolean): StatusKey {
  if (emergencyActive && s.status === 'ONLINE') return 'EMERGENCY';
  if (s.status === 'PENDING' || !s.status) return 'PENDING';
  if (s.status !== 'ONLINE') return 'OFFLINE';
  // ONLINE — check freshness + cache
  if (s.lastPingAt) {
    const ageMs = Date.now() - new Date(s.lastPingAt).getTime();
    if (ageMs > 5 * 60_000) return 'STALE';
  }
  const emergencyCount = s.lastCacheReport?.emergency?.count || 0;
  if (emergencyCount === 0) return 'ONLINE_NO_CACHE';
  return 'ONLINE_READY';
}

// Inline SVG paths for each Lucide icon — keyed by the same StatusKey
// so the pin shape doubles up with the color. WCAG 1.4.1 (Use of
// Color): ~8% of male users can't reliably distinguish the red /
// orange / amber band that STALE, OFFLINE, and ONLINE_NO_CACHE all
// share. The icon shape is the secondary perceptual channel.
//
// Why inline SVG (not <Icon />): leaflet's DivIcon takes an HTML
// string, not a React node — we need plain SVG markup to inject.
// Source paths copied verbatim from lucide-react ESM modules
// (v1.8.0; ISC-licensed) — see node_modules/.pnpm/lucide-react@*/
// node_modules/lucide-react/dist/esm/icons/<name>.js.
const STATUS_ICON_SVG: Record<StatusKey, string> = {
  EMERGENCY: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  ONLINE_READY: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  ONLINE_NO_CACHE: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  STALE: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  OFFLINE: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  PENDING: '<path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>',
};

const STATUS_META: Record<StatusKey, { color: string; label: string; icon: typeof MonitorPlay }> = {
  EMERGENCY: { color: '#dc2626', label: 'EMERGENCY ACTIVE', icon: AlertTriangle },
  ONLINE_READY: { color: '#10b981', label: 'Online · cache ready', icon: ShieldCheck },
  ONLINE_NO_CACHE: { color: '#f59e0b', label: 'Online · NO emergency cache', icon: Wifi },
  STALE: { color: '#f97316', label: 'Online · stale sync (>5m)', icon: Clock },
  OFFLINE: { color: '#ef4444', label: 'Offline', icon: WifiOff },
  PENDING: { color: '#94a3b8', label: 'Unpaired', icon: MonitorPlay },
};

/** Build a Leaflet DivIcon with the given color + shape (Lucide
 *  icon) + ring + emergency pulse. Per WCAG 1.4.1, the shape is
 *  the non-color channel — STALE / OFFLINE / ONLINE_NO_CACHE all
 *  sit in the red-orange band so color alone fails a CVD user. */
function buildIcon(status: StatusKey): L.DivIcon {
  const meta = STATUS_META[status];
  const pulse = status === 'EMERGENCY' ? 'edu-pin-pulse' : '';
  const inner = STATUS_ICON_SVG[status];
  // Build the SVG once, inline. 14×14 viewBox fits inside a 24px
  // pin. White stroke on the colored background hits AA contrast
  // against every status color.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const html = `<div class="edu-pin ${pulse}" style="background:${meta.color}" role="img" aria-label="${meta.label}">${svg}</div>`;
  return L.divIcon({
    html,
    className: 'edu-pin-wrap',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Auto-fit map to all marker bounds when they change. */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, map]);
  return null;
}

interface Props {
  screens: ScreenForMap[];
  emergencyActive?: boolean;
  onScreenClick?: (screenId: string) => void;
}

export function ScreenMap({ screens, emergencyActive = false, onScreenClick }: Props) {
  // Filter out screens without coordinates — they show in the list but
  // can't be plotted. Show a count below the map if any are missing.
  const located = useMemo(
    () => screens.filter(s => s.latitude != null && s.longitude != null),
    [screens],
  );
  const unmappedCount = screens.length - located.length;
  const points: Array<[number, number]> = located.map(s => [s.latitude!, s.longitude!]);

  // Default center: continental US if we have nothing yet.
  const defaultCenter: [number, number] = points[0] ?? [39.5, -98.35];
  const defaultZoom = points.length > 0 ? 12 : 4;

  // Group counts for the legend
  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      EMERGENCY: 0, ONLINE_READY: 0, ONLINE_NO_CACHE: 0, STALE: 0, OFFLINE: 0, PENDING: 0,
    };
    for (const s of located) c[classifyScreen(s, emergencyActive)]++;
    return c;
  }, [located, emergencyActive]);

  return (
    <div className="space-y-3">
      <div className="relative h-[600px] w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        <MapContainer
          center={defaultCenter}
          zoom={defaultZoom}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <FitBounds points={points} />
          {located.map(s => {
            const status = classifyScreen(s, emergencyActive);
            const meta = STATUS_META[status];
            return (
              <Marker
                key={s.id}
                position={[s.latitude!, s.longitude!]}
                icon={buildIcon(status)}
                eventHandlers={{ click: () => onScreenClick?.(s.id) }}
              >
                <Popup>
                  <div className="text-xs">
                    <div className="font-bold text-slate-800 mb-1">{s.name}</div>
                    <div className="font-bold uppercase tracking-wider text-[10px] mb-1.5" style={{ color: meta.color }}>
                      {meta.label}
                    </div>
                    {s.address && <div className="text-slate-500 mb-1">{s.address}</div>}
                    {s.geoSource === 'tenant' && (
                      <div
                        className="text-[10px] font-semibold mb-1 rounded px-1.5 py-0.5 inline-block"
                        style={{ background: '#eef2ff', color: '#4338ca' }}
                        title="No per-screen pin yet — showing the building location. Click the screen card to drop a precise pin."
                      >
                        Building location
                      </div>
                    )}
                    {s.lastPingAt && (
                      <div className="text-slate-400 text-[10px]">
                        Last ping {new Date(s.lastPingAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Legend + summary — A3 a11y fix: legend swatch is the same
          colored pin + Lucide icon used on the map so a CVD user
          can match each swatch to its on-map pin by SHAPE. */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {(Object.keys(STATUS_META) as StatusKey[]).map(k => {
          const Icon = STATUS_META[k].icon;
          return (
            <div key={k} className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full ring-2 ring-white shadow"
                style={{ background: STATUS_META[k].color }}
                aria-hidden
              >
                <Icon className="w-3 h-3 text-white" strokeWidth={2.4} />
              </span>
              <span className="font-semibold text-slate-600">{STATUS_META[k].label}</span>
              <span className="font-mono text-slate-400">({counts[k]})</span>
            </div>
          );
        })}
        {unmappedCount > 0 && (
          <div className="text-slate-500 font-medium ml-auto">
            {unmappedCount} screen{unmappedCount === 1 ? '' : 's'} have no location set
          </div>
        )}
      </div>

      {/* Inline styles for the pin — kept here to avoid a separate stylesheet */}
      <style jsx global>{`
        .edu-pin-wrap { background: transparent !important; border: 0 !important; }
        .edu-pin {
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          box-shadow: 0 0 0 3px white, 0 4px 12px rgba(15, 23, 42, 0.25);
          border: 2px solid white;
          /* A11y audit (2026-05-25, A3): center the inline Lucide SVG
             inside the colored circle. The SVG is the shape channel
             that complements color — WCAG 1.4.1 (Use of Color). */
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .edu-pin svg { display: block; }
        .edu-pin-pulse {
          animation: edu-pin-pulse 1.2s ease-in-out infinite;
        }
        @keyframes edu-pin-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 3px white, 0 0 0 0 rgba(220, 38, 38, 0.7); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 3px white, 0 0 0 14px rgba(220, 38, 38, 0); }
        }
        .leaflet-popup-content { margin: 8px 12px; min-width: 180px; }
      `}</style>
    </div>
  );
}
