"use client";
import { usePolledFeed } from "./use-live-feed";
export interface ReferenceRates {
  base: string;
  date: string;
  fetchedAt: string;
  source: string;
  rates: { code: string; rate: number }[];
}
const API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
).replace(/\/$/, "");
export function useReferenceRates(active: boolean, base: string) {
  return usePolledFeed<ReferenceRates>(
    active,
    () => `${API}/feeds/reference-rates?base=${encodeURIComponent(base)}`,
    3600000,
    3600000,
  );
}
export const DISPLAY_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "NZD",
  "MXN",
];
