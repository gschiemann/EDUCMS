"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Inbox,
  MapPin,
  MonitorPlay,
  Wifi,
  X,
} from "lucide-react";
import { deriveStores, type MapGroup, type ScreenForMap } from "./mapStores";
import { storeLocationPins } from "./mapLocationPins";
import { LocationMapFilters, LocationMapSurface } from "./LocationMapSurface";
import type { OpsRow, OpsScreen } from "./v3/screenOps";

type Filter = "all" | "healthy" | "offline" | "drift" | "push" | "attention";
const FILTERS: Array<{ key: Filter; dot?: string }> = [
  { key: "all" },
  { key: "healthy", dot: "#10b981" },
  { key: "offline", dot: "#f43f5e" },
  { key: "drift", dot: "#f59e0b" },
  { key: "push", dot: "#f43f5e" },
  { key: "attention", dot: "#f97316" },
];
const CARD =
  "bg-white rounded-2xl border border-slate-200/90 shadow-[0_1px_3px_rgba(15,23,42,0.05)]";
const PANEL =
  "bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] overflow-hidden flex flex-col";
type GeoScreen = OpsScreen & {
  latitude?: number | null;
  longitude?: number | null;
  effectiveLatitude?: number | null;
  effectiveLongitude?: number | null;
};

export function ScreenLocationAtlas({
  screens,
  rows,
  groups,
  logoUrl,
  onOpenScreen,
  onList,
}: {
  screens: OpsScreen[];
  rows: OpsRow[];
  groups: MapGroup[];
  logoUrl: string | null;
  onOpenScreen: (id: string) => void;
  onList: () => void;
}) {
  const t = useTranslations();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [panTo, setPanTo] = useState<{
    lat: number;
    lng: number;
    nonce: number;
  } | null>(null);
  const stores = useMemo(
    () =>
      deriveStores(
        screens.map((screen) => {
          const s = screen as GeoScreen;
          return {
            id: s.id,
            name: s.name || "Screen",
            status: s.status || "PENDING",
            latitude: s.effectiveLatitude ?? s.latitude ?? null,
            longitude: s.effectiveLongitude ?? s.longitude ?? null,
            address: s.effectiveAddress ?? s.address,
            screenGroupId: s.screenGroupId,
            screenGroupName: s.screenGroup?.name,
            geoSource: s.geoSource,
          } satisfies ScreenForMap;
        }),
        false,
        groups,
      ),
    [screens, groups],
  );
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.screen.id, row])),
    [rows],
  );
  const storesByKey = useMemo(() => new Map(stores.map(store => [store.key, store])), [stores]);
  const allPins = useMemo(
    () =>
      storeLocationPins(stores, logoUrl, selected).map((pin) => {
        const store = storesByKey.get(pin.id)!;
        const mine = store.devices
          .map((s) => rowsById.get(s.id))
          .filter((r): r is OpsRow => !!r);
        const tone: "ok" | "warn" | "bad" = mine.some(
          (r) => r.status.tone === "bad",
        )
          ? "bad"
          : mine.some(
                (r) => r.status.needsAttention || r.status.tone === "warn",
              ) || mine.length === 0
            ? "warn"
            : "ok";
        return { ...pin, tone };
      }),
    [stores, storesByKey, rowsById, logoUrl, selected],
  );
  const visiblePins = allPins.filter((pin) => {
    if (filter === "all") return true;
    if (filter === "healthy") return pin.tone === "ok";
    const store = storesByKey.get(pin.id)!;
    return store.devices.some((s) => {
      const row = rowsById.get(s.id);
      if (!row) return false;
      return filter === "attention"
        ? row.status.needsAttention
        : row.status.key ===
            (filter === "drift"
              ? "content-behind"
              : filter === "push"
                ? "push-delayed"
                : "offline");
    });
  });
  const selectedStore = stores.find((s) => s.key === selected);
  const selectedPin = allPins.find((p) => p.id === selected);
  const exceptions = rows.filter((row) => row.status.needsAttention);
  const current = rows.filter((row) => row.status.key === "current").length;
  const select = (key: string) => {
    const store = stores.find((s) => s.key === key);
    if (!store) return;
    setSelected(key);
    setPanTo((prev) => ({
      lat: store.lat,
      lng: store.lng,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };
  const chooseException = (row: OpsRow) => {
    const store = stores.find((s) =>
      s.devices.some((d) => d.id === row.screen.id),
    );
    if (store) select(store.key);
    else onOpenScreen(row.screen.id);
  };
  const missing = groups.filter(
    (g) => g.latitude == null || g.longitude == null,
  );

  return (
    <div className="space-y-3" data-testid="screens-location-atlas">
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        role="group"
        aria-label={t("screens.atlas.fleetTotals")}
      >
        {[
          {
            label: t("screens.atlas.locations"),
            value: stores.length,
            Icon: MapPin,
            bg: "var(--brand-primary, #4f46e5)",
            action: onList,
          },
          {
            label: t("screens.atlas.screens"),
            value: screens.length,
            Icon: MonitorPlay,
            bg: "#2563eb",
            action: onList,
          },
          {
            label: t("screens.atlas.contentCurrent"),
            value: current,
            Icon: CheckCircle2,
            bg: "#10b981",
            action: () => setFilter("healthy"),
          },
          {
            label: t("screens.atlas.needAttention"),
            value: exceptions.length,
            Icon: AlertTriangle,
            bg: "#f97316",
            action: () => setFilter("attention"),
          },
        ].map(({ label, value, Icon, bg, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className={`${CARD} px-4 py-3 flex items-center gap-3 text-left hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-400`}
          >
            <span
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white"
              style={{ background: bg }}
            >
              <Icon className="w-5 h-5" aria-hidden />
            </span>
            <span>
              <span className="block text-[22px] font-black text-slate-900 leading-tight">
                {value}
              </span>
              <span className="block text-[12px] font-semibold text-slate-500">
                {label}
              </span>
            </span>
          </button>
        ))}
      </div>
      <LocationMapSurface
        locationPins={visiblePins}
        total={allPins.length}
        onLocationClick={select}
        panTo={panTo}
        empty={
          <div className="h-[60vh] min-h-[380px] flex flex-col items-center justify-center text-center px-6">
            <MapPin className="w-8 h-8 text-slate-300" aria-hidden />
            <p className="mt-3 font-bold text-slate-600">
              {t("screens.atlas.emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t("screens.atlas.emptyHint")}
            </p>
          </div>
        }
      >
        {allPins.length > 0 && (
          <LocationMapFilters
            filters={FILTERS.map((f) => ({ ...f, label: t(`screens.atlas.filters.${f.key}`) }))}
            selected={filter}
            onChange={setFilter}
          />
        )}
        {allPins.length > 0 && visiblePins.length === 0 && (
          <p className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] rounded-full bg-white px-4 py-2 text-xs font-bold shadow">
            {t("screens.atlas.noMatch")}
          </p>
        )}
        {allPins.length > 0 && (
          <div
            className={`absolute top-[60px] lg:top-3 left-3 z-[1000] w-[304px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-14rem)] lg:max-h-[calc(100%-9rem)] ${PANEL} ${selected ? "hidden lg:flex" : ""}`}
            role="group"
            aria-label={t("screens.atlas.locationNavigation")}
          >
            <h3 className="px-4 py-2.5 border-b border-slate-100 text-[12.5px] font-black flex items-center gap-2">
              <Building2 className="w-4 h-4" aria-hidden />
              {t("screens.atlas.locations")}
            </h3>
            <div className="overflow-y-auto">
              {visiblePins.map((pin) => (
                <button
                  key={pin.id}
                  type="button"
                  onClick={() => select(pin.id)}
                  aria-pressed={selected === pin.id}
                  className="w-full px-4 py-2 text-left border-b border-slate-100 hover:bg-slate-50 text-xs font-bold"
                >
                  <span
                    className="inline-block mr-2 w-2 h-2 rounded-full"
                    style={{
                      background:
                        pin.tone === "ok"
                          ? "#10b981"
                          : pin.tone === "bad"
                            ? "#f43f5e"
                            : "#f59e0b",
                    }}
                    aria-hidden
                  />
                  {pin.name}
                </button>
              ))}
              {exceptions.length > 0 && (
                <>
                  <h3 className="px-4 py-2.5 border-b border-slate-100 text-[12.5px] font-black flex items-center gap-2">
                    <Inbox className="w-4 h-4" aria-hidden />
                    {t("screens.atlas.exceptionInbox")}
                  </h3>
                  {exceptions.map((row) => (
                    <button
                      key={row.screen.id}
                      type="button"
                      onClick={() => chooseException(row)}
                      className="w-full px-4 py-2 text-left border-b border-slate-100 hover:bg-slate-50"
                    >
                      <span className="block text-xs font-bold">
                        {row.screen.name || t("screens.atlas.screenFallback")}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {row.status.label}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
        {selectedStore && selectedPin && (
          <div
            className={`absolute top-[60px] lg:top-[60px] right-3 z-[1000] w-[372px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-14rem)] lg:max-h-[calc(100%-8rem)] ${PANEL}`}
            role="group"
            aria-label={t("screens.atlas.details", { name: selectedPin.name })}
          >
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
              <Building2 className="w-4 h-4" aria-hidden />
              <h3 className="text-[12.5px] font-black">{t("screens.atlas.selectedLocation")}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t("screens.atlas.closeDetails")}
                className="ml-auto p-1"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            <div className="overflow-y-auto">
              <div className="px-4 py-3 flex items-center gap-3">
                <span
                  className="relative flex w-14 h-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white border-[3px]"
                  style={{
                    borderColor:
                      selectedPin.tone === "ok"
                        ? "#10b981"
                        : selectedPin.tone === "bad"
                          ? "#f43f5e"
                          : "#f59e0b",
                  }}
                >
                  <span className="text-sm font-black">
                    {selectedPin.initials}
                  </span>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- Display tenant logos directly and reveal initials on image errors.
                    <img
                      key={logoUrl}
                      src={logoUrl}
                      alt=""
                      className="absolute top-1 left-1 w-10 h-10 object-contain bg-white"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </span>
                <span>
                  <strong className="block text-[19px] leading-tight">
                    {selectedPin.name}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {selectedStore.label}
                    {selectedStore.city ? `, ${selectedStore.city}` : ""}
                  </span>
                </span>
              </div>
              {selectedStore.groups.map((group) => (
                <div
                  key={group.id ?? "ungrouped"}
                  className="px-4 pb-3 border-t border-slate-100 pt-2"
                >
                  <h4 className="text-xs font-black mb-1">{group.name}</h4>
                  {group.devices.length === 0 && (
                    <p className="text-xs text-slate-500">{t("screens.atlas.noScreens")}</p>
                  )}
                  {group.devices.map((screen) => (
                    <button
                      key={screen.id}
                      type="button"
                      onClick={() => onOpenScreen(screen.id)}
                      className="w-full text-left py-2 hover:bg-slate-50"
                    >
                      <span className="block text-xs font-bold">
                        {screen.name}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {rowsById.get(screen.id)?.status.label ??
                          t("screens.atlas.statusUnconfirmed")}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {missing.length > 0 && (
          <div
            className={`absolute bottom-3 left-3 z-[1000] max-w-[calc(100%-1.5rem)] ${PANEL} px-4 py-3`}
          >
            <h3 className="text-xs font-black">{t("screens.atlas.notOnMap")}</h3>
            <p className="text-[11px] text-slate-500">
              {t("screens.atlas.groupsNeedAddress", { count: missing.length })}
            </p>
            <button
              type="button"
              onClick={onList}
              className="mt-2 text-xs font-bold text-indigo-700"
            >
              {t("screens.atlas.editGroupLocations")}
            </button>
          </div>
        )}
        {allPins.length > 0 && (
          <div
            className={`hidden lg:flex absolute bottom-3 right-3 z-[1000] max-w-[calc(100%-1.5rem)] ${PANEL} px-4 py-3`}
            role="group"
            aria-label={t("screens.atlas.onlineNotCurrent")}
          >
            <h3 className="text-xs font-black">{t("screens.atlas.onlineNotCurrent")}</h3>
            <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-2">
              <Wifi className="w-3 h-3" aria-hidden />
              {t("screens.atlas.onlineNotCurrentHint")}
            </p>
          </div>
        )}
      </LocationMapSurface>
    </div>
  );
}
