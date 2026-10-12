"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Inbox,
  MapPin,
  MonitorPlay,
  ShieldAlert,
  X,
} from "lucide-react";
import { deriveStores, type MapGroup, type ScreenForMap } from "./mapStores";
import { storeLocationPins } from "./mapLocationPins";
import { LocationMapFilters, LocationMapSurface } from "./LocationMapSurface";
import type { MapPanTarget } from "./ScreenMap";
import type { OpsRow, OpsScreen } from "./v3/screenOps";
// 2026-10-12 — the SAME alerts, chips, summary and fix the organisation map
// (FleetCommandCenter) uses. Owner: "parent accounts and just standard
// account maps have the same alerts and action items". A pin here is an
// address inside this location; there it is a location. Nothing below
// cares: both are `MapPlace`s of screens graded by `gradeMapScreen`.
import {
  MAP_FILTER_CHIPS,
  ALERT_FILTER,
  fromOpsScreen,
  matchesMapFilter,
  placeTone,
  summarizeMapAlerts,
  toMapAlertScreen,
  type MapAlertKind,
  type MapAlertScreen,
  type MapFilterKey,
  type MapPlace,
} from "@/components/fleet-map/mapAlerts";
import { MapPlaceFix } from "@/components/fleet-map/MapPlaceFix";
import { MAP_STATE_STYLE, useMapStateLabel } from "@/components/fleet-map/MapScreenBadge";
import { FOCUS_ZOOM, useFocusOnNonce } from "@/components/fleet-map/focus";
import { FleetLiveSummary } from "@/components/dashboard/district/FleetLiveSummary";

type Filter = MapFilterKey;
/** The summary's bucket for screens with no address (no pin). */
const UNPLACED_ID = "__unplaced__";
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
  deployedSha = null,
  deployedBundleId = null,
  locationName = "",
  emergencyGap = null,
  now: nowProp,
}: {
  screens: OpsScreen[];
  rows: OpsRow[];
  groups: MapGroup[];
  logoUrl: string | null;
  onOpenScreen: (id: string) => void;
  onList: () => void;
  /** The deployed web build — what "on the previous web player" is measured against. */
  deployedSha?: string | null;
  deployedBundleId?: string | null;
  /** This location's name, for the emergency alert line. */
  locationName?: string;
  /** This location's emergency readiness gap (`emergencyGapOf`); null = none or unknown. */
  emergencyGap?: MapPlace["emergencyGap"];
  /** Fixed clock for tests. */
  now?: number;
}) {
  const t = useTranslations();
  const tMap = useTranslations("fleetMap");
  const mapStateLabel = useMapStateLabel();
  const router = useRouter();
  const params = useParams<{ schoolId?: string }>();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [panTo, setPanTo] = useState<MapPanTarget | null>(null);
  const [fixFocusNonce, setFixFocusNonce] = useState(0);
  const fixRef = useFocusOnNonce<HTMLDivElement>(fixFocusNonce);
  // One clock read per payload (the screens poll), shared by every grade.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the data changes, never on a timer
  const gradedAt = useMemo(() => nowProp ?? Date.now(), [screens, nowProp]);
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
  /** Every screen graded ONCE by `gradeMapScreen` — the organisation map's grader. */
  const mapScreenById = useMemo(() => {
    const m = new Map<string, MapAlertScreen>();
    for (const s of screens) m.set(s.id, toMapAlertScreen(fromOpsScreen(s), deployedSha, deployedBundleId, gradedAt));
    return m;
  }, [screens, deployedSha, deployedBundleId, gradedAt]);
  const pushStaleById = useMemo(
    () => new Set(screens.filter((s) => s.status === "ONLINE" && s.pushChannel === "stale").map((s) => s.id)),
    [screens],
  );
  const pinNames = useMemo(
    () => new Map(storeLocationPins(stores, logoUrl, null, (first, more) => t("screens.atlas.nameAndMoreGroups", { name: first, count: more })).map((p) => [p.id, p.name])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale
    [stores, logoUrl],
  );
  /**
   * This map's places — one per address. The emergency gap belongs to the
   * whole location, so every address carries it (the chip and each card's
   * fix); the summary names it ONCE, under the location's own name.
   */
  const places = useMemo<MapPlace[]>(
    () =>
      stores.map((store) => ({
        id: store.key,
        name: pinNames.get(store.key) ?? store.label,
        screens: store.devices.map((d) => mapScreenById.get(d.id)).filter((s): s is MapAlertScreen => !!s),
        pushStale: store.devices.filter((d) => pushStaleById.has(d.id)).length,
        emergencyGap,
      })),
    [stores, pinNames, mapScreenById, pushStaleById, emergencyGap],
  );
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const liveSummary = useMemo(() => {
    const perAddress = places.map((p) => ({ ...p, emergencyGap: null }));
    // Screens not on the map (no address) still count — the summary is the
    // whole location, like the organisation map's is the whole scope.
    const placed = new Set(perAddress.flatMap((p) => p.screens.map((s) => s.id)));
    const unplaced = screens.map((s) => mapScreenById.get(s.id)).filter((s): s is MapAlertScreen => !!s && !placed.has(s.id));
    const extra: MapPlace[] = [];
    if (unplaced.length > 0) extra.push({ id: UNPLACED_ID, name: tMap("unplaced"), screens: unplaced, pushStale: 0, emergencyGap: null });
    if (emergencyGap && places.length > 0) {
      extra.push({ id: places[0].id, name: locationName || places[0].name, screens: [], pushStale: 0, emergencyGap });
    }
    return summarizeMapAlerts([...perAddress, ...extra]);
  }, [places, screens, mapScreenById, emergencyGap, locationName, tMap]);
  const allPins = useMemo(
    () =>
      storeLocationPins(stores, logoUrl, selected, (first, more) => t("screens.atlas.nameAndMoreGroups", { name: first, count: more })).map((pin) => {
        const place = placeById.get(pin.id);
        return { ...pin, tone: place ? placeTone(place) : ("ok" as const) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale
    [stores, placeById, logoUrl, selected],
  );
  const visiblePins = allPins.filter((pin) => {
    if (filter === "all") return true;
    const place = placeById.get(pin.id);
    return !!place && matchesMapFilter(place, filter);
  });
  const selectedStore = stores.find((s) => s.key === selected);
  const selectedPin = allPins.find((p) => p.id === selected);
  const selectedPlace = selected ? placeById.get(selected) : undefined;
  const exceptions = rows.filter((row) => row.status.needsAttention);
  const current = rows.filter((row) => row.status.key === "current").length;
  /** Screens that need someone — the organisation map's same rule. */
  const attentionCount = useMemo(() => {
    let n = 0;
    for (const s of mapScreenById.values()) {
      if (s.grade.state === "offline" || s.grade.state === "no-picture" || s.grade.state === "behind") n += 1;
    }
    return n;
  }, [mapScreenById]);
  /**
   * The ONE way into an address's fix — pin, list row or summary alert:
   * select it (the card opens), zoom to it, focus the card's fix block.
   */
  const select = (key: string) => {
    const store = stores.find((s) => s.key === key);
    if (!store) return;
    setSelected(key);
    setPanTo((prev) => ({
      lat: store.lat,
      lng: store.lng,
      nonce: (prev?.nonce ?? 0) + 1,
      zoom: FOCUS_ZOOM,
    }));
    setFixFocusNonce((n) => n + 1);
  };
  const onSummaryAlert = (kind: MapAlertKind, placeId: string) => {
    if (placeId === UNPLACED_ID) {
      // Screens with no address have no pin — the list is where they live.
      onList();
      return;
    }
    const place = placeById.get(placeId);
    if (place && filter !== "all" && !matchesMapFilter(place, filter)) setFilter(ALERT_FILTER[kind]);
    select(placeId);
  };
  const fixEmergency = () => router.push(`/${params?.schoolId ?? ""}/settings/emergency`);
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
            value: attentionCount,
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
            filters={MAP_FILTER_CHIPS.map((f) => ({ key: f.key, label: tMap(`filters.${f.key}`), dot: f.dot, Icon: f.shield ? ShieldAlert : undefined }))}
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
              {/* The fix — the organisation map's same block, first under
                  the name so an alert that opens this card lands on it. */}
              {selectedPlace && (
                <MapPlaceFix
                  ref={fixRef}
                  screens={selectedPlace.screens}
                  emergencyGap={selectedPlace.emergencyGap != null}
                  onOpenScreen={onOpenScreen}
                  onFixEmergency={fixEmergency}
                  now={gradedAt}
                />
              )}
              {selectedStore.groups.map((group) => (
                <div
                  key={group.id ?? "ungrouped"}
                  className="px-4 pb-3 border-t border-slate-100 pt-2"
                >
                  <h4 className="text-xs font-black mb-1">{group.name}</h4>
                  {group.devices.length === 0 && (
                    <p className="text-xs text-slate-500">{t("screens.atlas.noScreens")}</p>
                  )}
                  {group.devices.map((screen) => {
                    // The organisation map's word for this screen — same grader.
                    const graded = mapScreenById.get(screen.id);
                    const st = graded
                      ? mapStateLabel(graded.grade)
                      : { label: t("screens.atlas.statusUnconfirmed"), note: null, ...MAP_STATE_STYLE.unconfirmed };
                    return (
                      <button
                        key={screen.id}
                        type="button"
                        onClick={() => onOpenScreen(screen.id)}
                        title={st.note ?? undefined}
                        data-map-state={graded?.grade.state}
                        className="w-full text-left py-2 hover:bg-slate-50"
                      >
                        <span className="block text-xs font-bold">
                          {screen.name}
                        </span>
                        <span className={`flex items-center gap-1 text-[11px] font-bold ${st.cls}`}>
                          <st.Icon className="w-3 h-3 shrink-0" aria-hidden />
                          {st.label}
                        </span>
                      </button>
                    );
                  })}
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
        {/* The organisation map's live summary, unchanged — same counts,
            same alert, same doors into the fix. */}
        {allPins.length > 0 && (
          <FleetLiveSummary
            summary={liveSummary}
            filter={filter}
            onFilter={setFilter}
            onAlert={onSummaryAlert}
            now={nowProp}
            className="hidden lg:block absolute bottom-3 right-3 z-[1000] w-[300px] max-w-[calc(100%-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] px-4 py-3"
          />
        )}
      </LocationMapSurface>
      {allPins.length > 0 && (
        <FleetLiveSummary
          summary={liveSummary}
          filter={filter}
          onFilter={setFilter}
          onAlert={onSummaryAlert}
          now={nowProp}
          className={`${CARD} lg:hidden px-4 py-3`}
        />
      )}
    </div>
  );
}
