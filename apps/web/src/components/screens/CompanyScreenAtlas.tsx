"use client";

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { FleetLocation, FleetOperationsResponse } from '@/hooks/use-api';
import { buildFleetCommand, locationTone } from '@/components/dashboard/district/fleetCommand';
import type { OpsRow, OpsScreen } from './v3/screenOps';
import type { LocationPin } from './ScreenMap';
import { LocationMapSurface } from './LocationMapSurface';

/** Company locations use the dashboard's pins, coordinates and health grading. */
export function CompanyScreenAtlas({ fleet, locations, screens, rows, isFiltered, logoUrl, deployedSha, deployedBundleId, onOpenScreen, onLocationList }: {
  fleet: FleetOperationsResponse;
  locations: FleetLocation[];
  screens: OpsScreen[];
  rows: OpsRow[];
  isFiltered: boolean;
  logoUrl: string | null;
  deployedSha: string | null;
  deployedBundleId: string | null;
  onOpenScreen: (id: string) => void;
  onLocationList: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visibleLocations = useMemo(() => {
    const ids = new Set(screens.map((s) => s.sourceTenant?.id));
    return isFiltered ? locations.filter((l) => ids.has(l.id)) : locations;
  }, [locations, screens, isFiltered]);
  const command = useMemo(() => buildFleetCommand({
    screens: fleet.screens, deployedSha, deployedBundleId,
    rollupInput: { locations: visibleLocations, rootId: fleet.root?.id, screens: fleet.screens, readiness: null, approvals: null },
  }), [fleet, visibleLocations, deployedSha, deployedBundleId]);
  const locationMeta = useMemo(() => new Map(visibleLocations.map((l) => [l.id, l])), [visibleLocations]);
  const locationGeo = useMemo(() => {
    const geo = new Map<string, { lat: number; lng: number }>();
    for (const screen of fleet.screens) {
      const id = screen.sourceTenant?.id;
      if (!id || geo.has(id) || screen.effectiveLatitude == null || screen.effectiveLongitude == null) continue;
      geo.set(id, { lat: screen.effectiveLatitude, lng: screen.effectiveLongitude });
    }
    for (const location of visibleLocations) {
      if (geo.has(location.id) || location.latitude == null || location.longitude == null) continue;
      geo.set(location.id, { lat: location.latitude, lng: location.longitude });
    }
    return geo;
  }, [fleet.screens, visibleLocations]);
  const pins = useMemo<LocationPin[]>(() => command.locations.flatMap((row) => {
    const meta = locationMeta.get(row.tenantId);
    const at = locationGeo.get(row.tenantId);
    if (!at) return [];
    return [{ id: row.tenantId, name: row.name, lat: at.lat, lng: at.lng, tone: locationTone(row),
      logoUrl: meta?.logoUrl ?? logoUrl, initials: row.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2), selected: selectedId === row.tenantId }];
  }), [command.locations, locationMeta, locationGeo, logoUrl, selectedId]);
  const selected = visibleLocations.find((l) => l.id === selectedId);
  const selectedRows = rows.filter((r) => r.screen.sourceTenant?.id === selectedId);
  const unmapped = visibleLocations.filter((l) => !pins.some((p) => p.id === l.id));

  return (
    <LocationMapSurface locationPins={pins} total={pins.length} compact onLocationClick={setSelectedId}
      empty={<div className="p-12 text-center text-sm text-slate-500">No mapped locations match this view.</div>}>
      {unmapped.length > 0 && (
        <details className="absolute left-3 bottom-3 z-[1000] max-w-[calc(100%-1.5rem)] w-72 rounded-2xl border border-slate-200 bg-white shadow-lg">
          <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-700">Not on the map yet · {unmapped.length}</summary>
          <div className="max-h-48 overflow-auto px-4 pb-3 space-y-2 text-xs">
            {unmapped.map((l) => <div key={l.id}><p className="font-bold">{l.name}</p><p className="text-slate-500">{l.address ? 'Address not located yet.' : 'No address saved.'}</p></div>)}
          </div>
        </details>
      )}
      {selected && (
        <div className="absolute top-3 right-3 z-[1000] w-80 max-w-[calc(100%-1.5rem)] rounded-2xl border border-slate-200 bg-white shadow-lg p-4" role="region" aria-label={`${selected.name} screens`}>
          <div className="flex items-center gap-2"><h3 className="font-bold text-sm flex-1">{selected.name}</h3><button type="button" onClick={() => setSelectedId(null)} aria-label="Close location"><X className="w-4 h-4" /></button></div>
          <p className="text-xs text-slate-500 mt-1">{selected.address || 'No address saved'}</p>
          <div className="max-h-64 overflow-auto mt-3 space-y-1">
            {selectedRows.length === 0 ? <p className="text-xs text-slate-500">No screens in this view.</p> : selectedRows.map((row) => (
              <button type="button" key={row.screen.id} onClick={() => onOpenScreen(row.screen.id)} className="w-full rounded-lg p-2 text-left hover:bg-slate-50 border border-slate-100">
                <span className="block text-xs font-bold text-slate-800">{row.screen.name}</span>
                <span className="block text-xs text-slate-500">{row.screen.status === 'ONLINE' ? 'Online' : 'Offline'} · {row.expected.name || 'Nothing scheduled'}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onLocationList(selected.id)} className="mt-3 text-xs font-bold text-slate-700 underline">View location in list</button>
        </div>
      )}
    </LocationMapSurface>
  );
}
