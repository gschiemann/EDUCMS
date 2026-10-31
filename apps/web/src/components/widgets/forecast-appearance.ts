import type { CSSProperties } from "react";
import { toCssTextStyle } from "./text-style-contract";

export const FORECAST_LAYOUTS: [string, string][] = [
  ["auto", "Automatic"],
  ["cards", "Cards"],
  ["clean", "Clean overlay"],
  ["strip", "Horizontal strip"],
  ["list", "Stacked list"],
];
export const FORECAST_TEXT_AREAS: [string, string][] = [
  ["forecastHeading", "Heading"],
  ["forecastLocationLabel", "Location name"],
  ["forecastDay", "Day names"],
  ["forecastDate", "Dates"],
  ["forecastCondition", "Conditions"],
  ["forecastHigh", "High temperatures"],
  ["forecastLow", "Low temperatures"],
  ["forecastDetails", "High / low and rain labels"],
  ["forecastFooter", "Source and update time"],
];
export function forecastLayout(value: unknown, ratio: number) {
  if (
    value === "cards" ||
    value === "clean" ||
    value === "strip" ||
    value === "list"
  )
    return value;
  return ratio > 3.5 ? "strip" : "cards";
}
export function forecastIsTransparent(config: Record<string, any>) {
  return typeof config.forecastTransparent === "boolean"
    ? config.forecastTransparent
    : config.forecastLayout === "clean";
}
export function forecastOpacity(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value)) / 100
    : fallback;
}
/** Same canonical toolbar transport as the rest of the builder, consumed on
 * both the editor and player surfaces. Omit wire-only positioning fields. */
export function forecastTextStyle(
  config: Record<string, any>,
  field: string,
): CSSProperties {
  const {
    hidden,
    offsetX: _x,
    offsetY: _y,
    ...css
  } = toCssTextStyle(config._styles?.[field]);
  return {
    ...css,
    ...(css.color ? { opacity: 1 } : {}),
    ...(hidden ? { visibility: "hidden" } : {}),
  } as CSSProperties;
}
