"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { MonitorPlay, AlertTriangle, ShieldCheck, Wifi, WifiOff, Clock, Search, X, Crosshair, Map as MapIcon, List, ChevronRight, Building2 } from 'lucide-react';

/**
 * Sprint 8 command-center fleet map — upgraded to sell the product.
 * Showcase scenario: 50-location QSR chain (Chipotle-tier spread).
 *
 * What's new vs the Sprint 8 baseline:
 *   - CARTO Voyager premium basemap (OSM data, beautiful cartography, free)
 *   - Optional light/dark basemap toggle (Voyager ↔ Dark Matter)
 *   - leaflet.markercluster: pins cluster at low zoom, burst on max zoom.
 *     Cluster bubble color = worst status inside it (red > amber > green).
 *   - Command-center stats strip above the map (total / online / offline /
 *     emergency) — styled to feel like a real operations dashboard.
 *   - Search / filter by name or address: matching pins stay, others dim.
 *     Single match → fly-to.
 *   - "Fit all" button on the map re-runs fitBounds to all located screens.
 *   - onMapClick? prop exposes a click hook for future "drop-a-pin" flow.
 *
 * Preserved from Sprint 8:
 *   - classifyScreen logic (unchanged)
 *   - STATUS_META colors + labels
 *   - WCAG 1.4.1 icon-shape pins (color + Lucide shape)
 *   - EMERGENCY pulse animation
 *   - coarse-pointer 44px touch target
 *   - Popup content
 *   - Legend with counts (desktop + mobile variants)
 *   - unmappedCount notice
 *
 * Props (additive — no existing prop removed or changed type):
 *   screens         ScreenForMap[]    — existing
 *   emergencyActive boolean           — existing (default false)
 *   onScreenClick   fn(id)            — existing
 *   onMapClick      fn(lat,lng)       — NEW optional hook for add-location
 */

export type ScreenForMap = {
  id: string;
  name: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  geoSource?: 'screen' | 'tenant' | 'none';
  lastPingAt?: string | null;
  lastCacheReport?: { emergency?: { count?: number; bytes?: number } } | null;
};

type StatusKey = 'EMERGENCY' | 'ONLINE_READY' | 'ONLINE_NO_CACHE' | 'STALE' | 'OFFLINE' | 'PENDING';

/** Severity order for cluster worst-case coloring: higher = worse. */
const STATUS_SEVERITY: Record<StatusKey, number> = {
  EMERGENCY: 5,
  OFFLINE: 4,
  STALE: 3,
  ONLINE_NO_CACHE: 2,
  PENDING: 1,
  ONLINE_READY: 0,
};

function classifyScreen(s: ScreenForMap, emergencyActive: boolean): StatusKey {
  if (emergencyActive && s.status === 'ONLINE') return 'EMERGENCY';
  if (s.status === 'PENDING' || !s.status) return 'PENDING';
  if (s.status !== 'ONLINE') return 'OFFLINE';
  if (s.lastPingAt) {
    const ageMs = Date.now() - new Date(s.lastPingAt).getTime();
    if (ageMs > 5 * 60_000) return 'STALE';
  }
  const emergencyCount = s.lastCacheReport?.emergency?.count || 0;
  if (emergencyCount === 0) return 'ONLINE_NO_CACHE';
  return 'ONLINE_READY';
}

// ── Store rollup ────────────────────────────────────────────────────────────
// A "store" is one physical location (e.g. a single QSR address) that may run
// several devices. Operators think in locations first, devices second — so we
// group co-located screens into a Store and let them drill down to the devices.
// The grouping key is the screen's address (normalized) when present, else a
// rounded lat/lng (~11 m), so screens at the same address collapse into one
// location with no schema/setup required.

export type Store = {
  key: string;
  label: string; // street line, e.g. "12657 Alcosta Blvd"
  city: string | null; // "San Ramon, CA"
  lat: number; // centroid
  lng: number;
  devices: ScreenForMap[];
  status: StatusKey; // worst status across devices (drives the rollup dot)
  fromTenant: boolean; // true if these pins are the building fallback, not real per-screen pins
};

/** Normalize an address into a stable grouping key (drops unit noise + trailing country). */
function normalizeAddrKey(addr?: string | null): string | null {
  if (!addr) return null;
  const k = addr
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\.?$/i, '')
    .replace(/\bste\b|\bsuite\b|\bunit\b|\bapt\b|#\s*\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return k || null;
}

/** Split a formatted address into a short street line + a "City, ST" line. */
function storeLabel(addr?: string | null): { label: string; city: string | null } {
  if (!addr) return { label: 'Pinned location', city: null };
  const parts = addr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa|united states)\.?$/i.test(p));
  const label = parts[0] ?? addr;
  // Prefer "City, ST" from the next two segments when they look like one.
  const city =
    parts.length >= 3 ? `${parts[1]}, ${parts[2].replace(/\s*\d{5}(-\d{4})?$/, '').trim()}` : parts[1] ?? null;
  return { label, city: city || null };
}

/** Group located screens into stores, worst-status-first then most-devices. */
function deriveStores(located: ScreenForMap[], emergencyActive: boolean): Store[] {
  const groups = new Map<string, ScreenForMap[]>();
  for (const s of located) {
    if (s.latitude == null || s.longitude == null) continue;
    const key =
      normalizeAddrKey(s.address) ?? `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }
  const stores: Store[] = [];
  for (const [key, devices] of groups) {
    const lat = devices.reduce((a, s) => a + (s.latitude as number), 0) / devices.length;
    const lng = devices.reduce((a, s) => a + (s.longitude as number), 0) / devices.length;
    let worst: StatusKey = 'ONLINE_READY';
    let sev = -1;
    for (const d of devices) {
      const st = classifyScreen(d, emergencyActive);
      if (STATUS_SEVERITY[st] > sev) {
        sev = STATUS_SEVERITY[st];
        worst = st;
      }
    }
    const { label, city } = storeLabel(devices[0].address);
    stores.push({
      key,
      label,
      city,
      lat,
      lng,
      devices,
      status: worst,
      fromTenant: devices.every((d) => d.geoSource === 'tenant'),
    });
  }
  stores.sort(
    (a, b) =>
      STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status] || b.devices.length - a.devices.length,
  );
  return stores;
}

// Inline SVG paths — same as Sprint 8 (verbatim lucide-react paths).
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

// CARTO Voyager — premium OSM-data basemap. Free, no key needed.
// Attribution is required by CARTO's terms.
const CARTO_VOYAGER = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function buildIcon(status: StatusKey): L.DivIcon {
  const meta = STATUS_META[status];
  const pulse = status === 'EMERGENCY' ? 'edu-pin-pulse' : '';
  const inner = STATUS_ICON_SVG[status];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const html = `<div class="edu-pin ${pulse}" style="background:${meta.color}" role="img" aria-label="${meta.label}">${svg}</div>`;
  return L.divIcon({
    html,
    className: 'edu-pin-wrap',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Auto-fit map to all marker bounds when they change (initial load only). */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    didFit.current = true;
  }, [points, map]);
  return null;
}

/** "Fit all" control — reruns fitBounds when the operator clicks the button.
 *  Lives inside the MapContainer so it can call useMap(). */
function FitAllControl({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const handleFit = useCallback(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);

  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: 80 }}>
      <div className="leaflet-control leaflet-bar">
        <button
          type="button"
          onClick={handleFit}
          title="Fit all locations"
          aria-label="Fit all locations"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            background: '#fff',
            border: 'none',
            cursor: 'pointer',
            color: '#374151',
          }}
        >
          <Crosshair style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  );
}

/** Optional onMapClick hook — wires a Leaflet map click handler.
 *  The lead uses this to build "drop a pin to add a location" later. */
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, onMapClick]);
  return null;
}

/**
 * InvalidateSizeOnShow — fixes the classic Leaflet "blank / grey map" that
 * appears when the map initializes in a container whose size isn't settled:
 * below the fold on mobile, inside an `h-[60dvh]` box before the dynamic-
 * viewport unit resolves, or in a grid still laying out. Leaflet measures 0×0
 * at init and never recovers on its own. We re-measure on a few short delays
 * after mount, whenever the container resizes, and the first time it scrolls
 * into view — so the fleet map paints on phones (operator 2026-06-03: "I don't
 * see the fleet map on the mobile app"). A no-op on desktop, where the map
 * already measures correctly. Dashboard-only surface → ResizeObserver /
 * IntersectionObserver are safe (no Taurus/Chromium-83 concern).
 */
function InvalidateSizeOnShow() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const timers = [50, 250, 600, 1200].map((ms) => setTimeout(fix, ms));
    const container = map.getContainer();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fix) : null;
    ro?.observe(container);
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) fix();
          })
        : null;
    io?.observe(container);
    window.addEventListener('resize', fix);
    window.addEventListener('orientationchange', fix);
    return () => {
      timers.forEach(clearTimeout);
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', fix);
      window.removeEventListener('orientationchange', fix);
    };
  }, [map]);
  return null;
}

/**
 * MarkerClusterLayer — raw leaflet.markercluster via useMap().
 *
 * Why raw plugin instead of a wrapper package: react-leaflet v5 broke
 * all known wrapper packages (react-leaflet-cluster, react-leaflet-
 * markercluster) — they rely on v4 createElementHook/createLayerComponent
 * internals that no longer exist. The useMap() approach is v5-safe:
 * build an L.markerClusterGroup, add to map, sync on prop change,
 * clean up on unmount.
 *
 * Cluster bubble coloring: we override the cluster icon factory to pick
 * the worst status color inside each cluster. The default CSS from
 * MarkerCluster.Default.css is imported above and then overridden via
 * the inline <style> block below.
 */
// WeakMap to tag each marker with its StatusKey without monkey-patching L.Marker.
// Lives at module scope (outside React) so the iconCreateFunction closure can read it.
const markerStatusMap = new WeakMap<L.Marker, StatusKey>();

function MarkerClusterLayer({
  screens,
  emergencyActive,
  query,
  onScreenClick,
}: {
  screens: ScreenForMap[];
  emergencyActive: boolean;
  query: string;
  onScreenClick?: (id: string) => void;
}) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    // Build the cluster group once.
    const group = L.markerClusterGroup({
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: L.MarkerCluster) => {
        const markers: L.Marker[] = cluster.getAllChildMarkers();
        // Find the worst status in this cluster using the WeakMap tag.
        let worstSeverity = -1;
        let worstStatus: StatusKey = 'ONLINE_READY';
        for (const m of markers) {
          const s = markerStatusMap.get(m);
          if (s !== undefined && STATUS_SEVERITY[s] > worstSeverity) {
            worstSeverity = STATUS_SEVERITY[s];
            worstStatus = s;
          }
        }
        const color = STATUS_META[worstStatus].color;
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="edu-cluster" style="background:${color};border-color:${color}"><span>${count}</span></div>`,
          className: 'edu-cluster-wrap',
          iconSize: L.point(40, 40),
          iconAnchor: L.point(20, 20),
        });
      },
    });

    map.addLayer(group);
    clusterGroupRef.current = group;

    return () => {
      map.removeLayer(group);
      clusterGroupRef.current = null;
    };
  }, [map]);

  // Rebuild markers whenever screens / filter / emergencyActive changes.
  useEffect(() => {
    const group = clusterGroupRef.current;
    if (!group) return;
    group.clearLayers();

    const q = query.trim().toLowerCase();

    for (const s of screens) {
      if (s.latitude == null || s.longitude == null) continue;

      // Filter: if a query is active, hide non-matching screens by skipping.
      if (q) {
        const haystack = `${s.name} ${s.address ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      const status = classifyScreen(s, emergencyActive);
      const icon = buildIcon(status);
      const meta = STATUS_META[status];

      const marker = L.marker([s.latitude, s.longitude], { icon });
      // Tag with status so iconCreateFunction can find the worst status per cluster.
      markerStatusMap.set(marker, status);

      // Build popup HTML (keep consistent with the old <Popup> content).
      const geoSourceBadge =
        s.geoSource === 'tenant'
          ? `<div style="font-size:10px;font-weight:600;margin-bottom:4px;background:#eef2ff;color:#4338ca;border-radius:4px;padding:2px 6px;display:inline-block;" title="No per-screen pin yet — showing the building location.">Building location</div>`
          : '';
      const pingLine = s.lastPingAt
        ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">Last ping ${new Date(s.lastPingAt).toLocaleString()}</div>`
        : '';
      const addrLine = s.address
        ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px;">${s.address}</div>`
        : '';

      const popupHtml = `
        <div style="font-size:12px;min-width:180px;">
          <div style="font-weight:700;color:#1e293b;margin-bottom:4px;">${s.name}</div>
          <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:10px;color:${meta.color};margin-bottom:6px;">${meta.label}</div>
          ${addrLine}${geoSourceBadge}${pingLine}
        </div>`;

      marker.bindPopup(popupHtml, { maxWidth: 240 });

      if (onScreenClick) {
        marker.on('click', () => onScreenClick(s.id));
      }

      group.addLayer(marker);
    }
  }, [screens, emergencyActive, query, onScreenClick]);

  return null;
}

/** Fly to a matched screen or a selected store. The `nonce` lets a repeat click
 *  on the SAME location re-trigger the fly (changing only `target` to identical
 *  coords would not). Zoom 16 is tight enough that a store's devices separate
 *  out of the cluster as you arrive. */
function FlyToTarget({ target, nonce }: { target: [number, number] | null; nonce?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo(target, 16, { animate: true, duration: 0.8 });
  }, [map, target, nonce]);
  return null;
}

interface Props {
  screens: ScreenForMap[];
  emergencyActive?: boolean;
  onScreenClick?: (screenId: string) => void;
  /** Optional hook for the "drop a pin to add a location" flow (lead builds later). */
  onMapClick?: (lat: number, lng: number) => void;
}

export function ScreenMap({ screens, emergencyActive = false, onScreenClick, onMapClick }: Props) {
  const [darkMap, setDarkMap] = useState(false);
  const [query, setQuery] = useState('');
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [flyNonce, setFlyNonce] = useState(0);
  const [openStoreKey, setOpenStoreKey] = useState<string | null>(null);

  const located = useMemo(
    () => screens.filter(s => s.latitude != null && s.longitude != null),
    [screens],
  );
  const unmappedCount = screens.length - located.length;
  const points: Array<[number, number]> = located.map(s => [s.latitude!, s.longitude!]);

  const defaultCenter: [number, number] = points[0] ?? [39.5, -98.35];
  const defaultZoom = points.length > 0 ? 12 : 4;

  // Group located screens into STORES (one physical location = one store, many
  // devices). The rail below lists stores; clicking one flies there + reveals
  // its devices — "top-level location, drill down to devices".
  const stores = useMemo(() => deriveStores(located, emergencyActive), [located, emergencyActive]);

  // Stats for the command-center strip.
  const stats = useMemo(() => {
    const counts: Record<StatusKey, number> = {
      EMERGENCY: 0, ONLINE_READY: 0, ONLINE_NO_CACHE: 0, STALE: 0, OFFLINE: 0, PENDING: 0,
    };
    for (const s of screens) counts[classifyScreen(s, emergencyActive)]++;
    const total = screens.length;
    const online = counts.ONLINE_READY + counts.ONLINE_NO_CACHE + counts.STALE;
    const offline = counts.OFFLINE;
    const emergency = counts.EMERGENCY;
    return { counts, total, online, offline, emergency };
  }, [screens, emergencyActive]);

  // Search handler: update flyTarget when exactly one match exists.
  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    const q = value.trim().toLowerCase();
    if (!q) { setFlyTarget(null); return; }
    const matches = located.filter(s =>
      `${s.name} ${s.address ?? ''}`.toLowerCase().includes(q)
    );
    if (matches.length === 1 && matches[0].latitude != null && matches[0].longitude != null) {
      setFlyTarget([matches[0].latitude!, matches[0].longitude!]);
      setFlyNonce(n => n + 1);
    } else {
      setFlyTarget(null);
    }
  }, [located]);

  // Store-row click: fly to the location and toggle its device drill-down.
  const handleStoreClick = useCallback((store: Store) => {
    setOpenStoreKey(prev => (prev === store.key ? null : store.key));
    setFlyTarget([store.lat, store.lng]);
    setFlyNonce(n => n + 1);
  }, []);

  // Same search box filters the rail (by store label/city or any device name).
  const filteredStores = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(st =>
      `${st.label} ${st.city ?? ''}`.toLowerCase().includes(q) ||
      st.devices.some(d => `${d.name} ${d.address ?? ''}`.toLowerCase().includes(q)),
    );
  }, [stores, query]);

  // Legend counts (same keys as Sprint 8).
  const counts = stats.counts;

  return (
    <div className="space-y-3">
      {/* ── Command-center stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Locations" value={stores.length} tone="neutral" sub={`${stats.total} device${stats.total === 1 ? '' : 's'}`} />
        <StatTile label="Online" value={stats.online} tone={stats.online === stats.total && stats.total > 0 ? 'ok' : 'neutral'} />
        <StatTile label="Offline" value={stats.offline} tone={stats.offline > 0 ? 'warn' : 'neutral'} />
        <StatTile label="Emergency" value={stats.emergency} tone={stats.emergency > 0 ? 'alert' : 'neutral'} />
      </div>

      {/* ── Search + basemap toggle bar ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Filter by name or address…"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
            aria-label="Filter locations"
          />
          {query && (
            <button
              type="button"
              onClick={() => handleSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Basemap toggle — Voyager (light) ↔ Dark Matter */}
        <button
          type="button"
          onClick={() => setDarkMap(d => !d)}
          title={darkMap ? 'Switch to light map' : 'Switch to dark map'}
          aria-label={darkMap ? 'Switch to light map' : 'Switch to dark map'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          {darkMap ? <MapIcon className="w-3.5 h-3.5" /> : <List className="w-3.5 h-3.5" />}
          {darkMap ? 'Light' : 'Dark'}
        </button>
      </div>

      {/* ── Mobile legend (above map) ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:hidden">
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
      </div>

      {/* ── Locations rail + Map (side-by-side on desktop, stacked on mobile) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-3">
        {/* Locations rail — top-level stores; click to fly there + drill into devices */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col overflow-hidden max-h-[300px] lg:max-h-none lg:h-[600px]">
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <Building2 className="w-3.5 h-3.5" aria-hidden /> Locations
            </span>
            <span className="text-[11px] font-mono text-slate-400">{filteredStores.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredStores.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                {located.length === 0
                  ? 'No screens have a location yet.'
                  : 'No locations match your search.'}
              </div>
            ) : (
              filteredStores.map(store => (
                <StoreRow
                  key={store.key}
                  store={store}
                  open={openStoreKey === store.key}
                  emergencyActive={emergencyActive}
                  onToggle={() => handleStoreClick(store)}
                  onDeviceClick={onScreenClick}
                />
              ))
            )}
          </div>
        </div>

        {/* Map */}
        <div className="relative h-[60dvh] max-h-[600px] sm:h-[600px] sm:max-h-none w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer
              key={darkMap ? 'dark' : 'light'}
              url={darkMap ? CARTO_DARK : CARTO_VOYAGER}
              attribution={CARTO_ATTRIBUTION}
              subdomains="abcd"
              maxZoom={20}
              // detectRetina: resolves {r} to '@2x' on HiDPI screens.
              // CARTO Voyager + Dark Matter both serve retina tiles at {r}.
              detectRetina
            />
            <InvalidateSizeOnShow />
            <FitBounds points={points} />
            <FitAllControl points={points} />
            <MarkerClusterLayer
              screens={located}
              emergencyActive={emergencyActive}
              query={query}
              onScreenClick={onScreenClick}
            />
            <FlyToTarget target={flyTarget} nonce={flyNonce} />
            {onMapClick && <MapClickHandler onMapClick={onMapClick} />}
          </MapContainer>
        </div>
      </div>

      {/* ── Desktop legend (below map) ── */}
      <div className="hidden sm:flex flex-wrap items-center gap-3 text-xs">
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

      {/* ── Inline styles ── */}
      <style jsx global>{`
        /* ── Individual pin ── */
        .edu-pin-wrap { background: transparent !important; border: 0 !important; }
        .edu-pin {
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          box-shadow: 0 0 0 3px white, 0 4px 12px rgba(15, 23, 42, 0.25);
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .edu-pin svg { display: block; }
        @media (pointer: coarse) {
          .edu-pin::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 44px;
            height: 44px;
            transform: translate(-50%, -50%);
          }
          .edu-pin { position: relative; }
        }
        .edu-pin-pulse {
          animation: edu-pin-pulse 1.2s ease-in-out infinite;
        }
        @keyframes edu-pin-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 3px white, 0 0 0 0 rgba(220, 38, 38, 0.7); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 3px white, 0 0 0 14px rgba(220, 38, 38, 0); }
        }

        /* ── Cluster bubble ── */
        .edu-cluster-wrap { background: transparent !important; border: 0 !important; }
        .edu-cluster {
          width: 40px;
          height: 40px;
          border-radius: 9999px;
          border: 3px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 800;
          font-size: 13px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          box-shadow: 0 0 0 4px rgba(255,255,255,0.55), 0 4px 16px rgba(15,23,42,0.22);
          opacity: 0.95;
        }
        .edu-cluster span {
          display: block;
          line-height: 1;
        }

        /* ── Popup ── */
        .leaflet-popup-content { margin: 8px 12px; min-width: 180px; }

        /* ── Fit-all control button hover ── */
        .leaflet-bar button:hover { background: #f1f5f9 !important; }
      `}</style>
    </div>
  );
}

// ── Stat tile sub-component (command-center strip) ──────────────────────────

type Tone = 'ok' | 'warn' | 'alert' | 'neutral';
const TONE_STYLES: Record<Tone, { bg: string; ring: string; text: string; num: string; dot?: string }> = {
  ok:      { bg: 'bg-emerald-50', ring: 'ring-emerald-100', text: 'text-emerald-600', num: 'text-emerald-700', dot: 'bg-emerald-400' },
  warn:    { bg: 'bg-amber-50',   ring: 'ring-amber-100',   text: 'text-amber-600',   num: 'text-amber-700',   dot: 'bg-amber-400' },
  alert:   { bg: 'bg-red-50',     ring: 'ring-red-100',     text: 'text-red-600',     num: 'text-red-700',     dot: 'bg-red-500' },
  neutral: { bg: 'bg-white',      ring: 'ring-slate-100',   text: 'text-slate-500',   num: 'text-slate-800' },
};

function StatTile({ label, value, tone, sub }: { label: string; value: number; tone: Tone; sub?: string }) {
  const s = TONE_STYLES[tone];
  return (
    <div className={`${s.bg} ring-1 ${s.ring} rounded-2xl px-4 py-3.5 flex flex-col gap-1 shadow-sm`}>
      <div className="flex items-center gap-1.5">
        {s.dot && (
          <span
            className={`inline-block w-2 h-2 rounded-full ${s.dot} ${tone === 'alert' ? 'animate-pulse' : ''}`}
            aria-hidden
          />
        )}
        <span className={`text-[10px] font-bold uppercase tracking-wider ${s.text}`}>{label}</span>
      </div>
      <span className={`text-3xl font-black ${s.num} leading-none`}>{value}</span>
      {sub && <span className="text-[10px] font-medium text-slate-400 mt-0.5">{sub}</span>}
    </div>
  );
}

// ── Store row (Locations rail) ──────────────────────────────────────────────
// A collapsible top-level location. Click flies the map there; expanding lists
// the devices at that location, each clickable to open the screen.

/** Short, human status word for a device sub-row. */
function deviceStatusWord(st: StatusKey): string {
  switch (st) {
    case 'ONLINE_READY':
    case 'ONLINE_NO_CACHE':
      return 'online';
    case 'OFFLINE':
      return 'offline';
    case 'STALE':
      return 'stale';
    case 'EMERGENCY':
      return 'alert';
    case 'PENDING':
      return 'unpaired';
  }
}

function StoreRow({
  store,
  open,
  emergencyActive,
  onToggle,
  onDeviceClick,
}: {
  store: Store;
  open: boolean;
  emergencyActive: boolean;
  onToggle: () => void;
  onDeviceClick?: (id: string) => void;
}) {
  const meta = STATUS_META[store.status];
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-slate-50 transition-colors ${open ? 'bg-slate-50' : ''}`}
      >
        <span
          className="inline-flex shrink-0 w-2.5 h-2.5 rounded-full ring-2 ring-white shadow"
          style={{ background: meta.color }}
          aria-label={meta.label}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block text-xs font-semibold text-slate-700 truncate">{store.label}</span>
            {store.fromTenant && (
              <span
                className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-indigo-500 bg-indigo-50 rounded px-1 py-0.5"
                title="No per-device pin yet — showing the building location."
              >
                building
              </span>
            )}
          </span>
          {store.city && <span className="block text-[10px] text-slate-400 truncate">{store.city}</span>}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-slate-400">
          {store.devices.length} {store.devices.length === 1 ? 'device' : 'devices'}
        </span>
        <ChevronRight
          className={`shrink-0 w-3.5 h-3.5 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="bg-slate-50/60 pb-1.5">
          {store.devices.map(d => {
            const st = classifyScreen(d, emergencyActive);
            const dm = STATUS_META[st];
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onDeviceClick?.(d.id)}
                className="w-full text-left pl-7 pr-3 py-1.5 flex items-center gap-2 hover:bg-white transition-colors"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: dm.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-[11px] text-slate-600 truncate">{d.name}</span>
                <span
                  className="shrink-0 text-[9px] uppercase tracking-wide font-bold"
                  style={{ color: dm.color }}
                >
                  {deviceStatusWord(st)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
