"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import type { LocationPin } from "./ScreenMap";
import { ScreenMapClient } from "./ScreenMapClient";

/** Compact cards leave the map's width available to the locations. */
const FIT_TOP_LEFT: [number, number] = [48, 90];
const FIT_BOTTOM_RIGHT: [number, number] = [180, 100];
const PANEL_FIT_BOTTOM_RIGHT: [number, number] = [400, 130];

/** Shared by the corporate dashboard and Screens: one map, one navigation layout. */
export function LocationMapSurface({
  locationPins,
  total,
  onLocationClick,
  panTo,
  compact = false,
  empty,
  children,
}: {
  locationPins: LocationPin[];
  total: number;
  onLocationClick: (id: string) => void;
  panTo?: { lat: number; lng: number; nonce: number } | null;
  /** Fleet dashboard opens with collapsed cards; Screens keeps its navigation rail. */
  compact?: boolean;
  empty: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="relative isolate rounded-2xl border border-slate-200 overflow-hidden bg-slate-100"
      data-testid="location-map-surface"
    >
      {total === 0 ? (
        empty
      ) : (
        <ScreenMapClient
          screens={[]}
          renderSidebar={false}
          locationPins={locationPins}
          onLocationClick={onLocationClick}
          panTo={panTo}
          heightClass="h-[60dvh] min-h-[360px] max-h-[600px] sm:h-[72vh] sm:min-h-[520px] sm:max-h-[900px]"
          fitPadTopLeft={compact ? FIT_TOP_LEFT : undefined}
          fitPadBottomRight={compact ? FIT_BOTTOM_RIGHT : PANEL_FIT_BOTTOM_RIGHT}
        />
      )}
      {children}
    </div>
  );
}

export function LocationMapFilters<T extends string>({
  filters,
  selected,
  onChange,
}: {
  filters: Array<{ key: T; label: string; dot?: string; Icon?: LucideIcon }>;
  selected: T;
  onChange: (key: T) => void;
}) {
  const t = useTranslations();
  return (
    <div
      className="absolute top-3 left-3 right-3 lg:left-auto z-[1000] flex items-center gap-1.5 flex-nowrap lg:flex-wrap justify-start lg:justify-end overflow-x-auto lg:overflow-visible max-w-[calc(100%-1.5rem)]"
      role="radiogroup"
      aria-label={t("screens.atlas.filterAria")}
    >
      {filters.map(({ key, label, dot, Icon }) => {
        const on = selected === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(key)}
            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full pl-3 pr-3.5 py-1.5 text-[11.5px] font-bold bg-white shadow-[0_2px_10px_rgba(15,23,42,0.12)] border"
            style={
              on
                ? {
                    borderColor: "var(--brand-primary, #4f46e5)",
                    color: "var(--brand-primary, #4f46e5)",
                    boxShadow:
                      "0 2px 10px rgba(15,23,42,0.12), 0 0 0 1px var(--brand-primary, #4f46e5) inset",
                  }
                : { borderColor: "#e2e8f0", color: "#334155" }
            }
          >
            {Icon ? (
              <Icon
                className="w-3.5 h-3.5 shrink-0 text-rose-500"
                aria-hidden
              />
            ) : dot ? (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: dot }}
                aria-hidden
              />
            ) : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
