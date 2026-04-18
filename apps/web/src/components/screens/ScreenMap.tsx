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
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
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

const STATUS_META: Record<StatusKey, { color: string; label: string; icon: typeof MonitorPlay }> = {
  EMERGENCY: { color: '#dc2626', label: 'EMERGENCY ACTIVE', icon: AlertTriangle },
  ONLINE_READY: { color: '#10b981', label: 'Online · cache ready', icon: ShieldCheck },
  ONLINE_NO_CACHE: { color: '#f59e0b', label: 'Online · NO emergency cache', icon: Wifi },
  STALE: { color: '#f97316', label: 'Online · stale sync (>5m)', icon: Clock },
  OFFLINE: { color: '#ef4444', label: 'Offline', icon: WifiOff },
  PENDING: { color: '#94a3b8', label: 'Unpaired', icon: MonitorPlay },
};

/** Build a Leaflet DivIcon with the given color + ring + emergency pulse. */
function buildIcon(status: StatusKey): L.DivIcon {
  const meta = STATUS_META[status];
  const pulse = status === 'EMERGENCY' ? 'edu-pin-pulse' : '';
  const html = `<div class="edu-pin ${pulse}" style="background:${meta.color}"></div>`;
  return L.divIcon({
    html,
    className: 'edu-pin-wrap',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
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

      {/* Legend + summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {(Object.keys(STATUS_META) as StatusKey[]).map(k => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full ring-2 ring-white shadow" style={{ background: STATUS_META[k].color }} />
            <span className="font-semibold text-slate-600">{STATUS_META[k].label}</span>
            <span className="font-mono text-slate-400">({counts[k]})</span>
          </div>
        ))}
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
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          box-shadow: 0 0 0 3px white, 0 4px 12px rgba(15, 23, 42, 0.25);
          border: 2px solid white;
        }
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
