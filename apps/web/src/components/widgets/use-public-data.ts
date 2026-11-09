"use client";
import { useEffect, useState } from "react";
import { usePolledFeed } from "./use-live-feed";
const API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
).replace(/\/$/, "");
export interface AirQualityFeed {
  source: string;
  sourceUrl?: string;
  location: string;
  area: string | null;
  state?: string;
  distanceKm?: number;
  matchedZip?: boolean;
  preliminary?: boolean;
  fetchedAt: string;
  reason?: string;
  observation: {
    aqi: number;
    category: string;
    color: string;
    observedAt: string;
    agency: string;
    pollutants: { name: string; aqi: number; category: string }[];
  } | null;
}
export interface AirportFeed {
  source: string;
  sourceUrl: string;
  airport: string;
  updatedAt: string;
  fetchedAt: string;
  items: {
    airport: string;
    type: string;
    reason: string;
    average: string;
    maximum: string;
    minimum: string;
    trend: string;
    start: string;
    end: string;
  }[];
}
export interface TransitFeed {
  source: string;
  sourceUrl: string;
  station: string;
  stationId: string;
  updatedAt: string;
  fetchedAt: string;
  items: {
    id: string;
    route: string;
    direction: string;
    platform: string;
    time: string;
    status: string;
    predictionKind: string;
  }[];
}
export function useAirQuality(location: string, active = true) {
  return usePolledFeed<AirQualityFeed>(
    active && !!location,
    () => `${API}/feeds/air-quality?location=${encodeURIComponent(location)}`,
    600000,
    1800000,
    25000,
    500,
  );
}
export function useAirportConditions(airport: string, active = true) {
  return usePolledFeed<AirportFeed>(
    active,
    () =>
      `${API}/feeds/airport-conditions?airport=${encodeURIComponent(airport)}`,
    120000,
    300000,
    15000,
    300,
  );
}
export function useTransitStations(active = true) {
  return usePolledFeed<{
    source: string;
    items: { id: string; name: string }[];
  }>(active, () => `${API}/feeds/transit-stations`, 86400000, 86400000, 15000);
}
export function useTransitArrivals(station: string, active = true) {
  return usePolledFeed<TransitFeed>(
    active && !!station,
    () =>
      `${API}/feeds/transit-arrivals?station=${encodeURIComponent(station)}`,
    30000,
    60000,
    25000,
    300,
  );
}
/** Refresh countdowns and expiration without one timer per data row. */
export function usePublicDataClock(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [active]); // perf-allow: one visible 30-second clock per live data board.
  return now;
}

export interface ParkingFeed {
  source: string;
  sourceUrl: string;
  region: string;
  location: string;
  supported: boolean;
  reason?: string;
  fetchedAt: string;
  items: {
    name: string;
    vacant: number;
    occupied: number;
    unknown: number;
    distanceKm: number;
    updatedAt: string | null;
  }[];
}
export function useParkingReports(location: string, active = true) {
  return usePolledFeed<ParkingFeed>(
    active && !!location,
    () =>
      `${API}/feeds/parking-reports?location=${encodeURIComponent(location)}`,
    60000,
    120000,
    25000,
    500,
  );
}

export interface RoadFeed {
  location: string;
  radiusKm?: number;
  supported: boolean;
  reason?: string;
  fetchedAt: string;
  /** Every publisher behind these rows (CHP, and each state DOT's WZDx feed). */
  sources?: { name: string; url: string; licenseUrl?: string; fetchedAt: string }[];
  items: {
    id: string;
    type: string;
    road: string;
    area: string;
    distanceKm: number;
    source?: string;
  }[];
}
/** Free road reports: CHP incidents (California) + DOT work zones (CC0 WZDx, 15 states + 2 metros). */
export function useRoadIncidents(location: string, active = true, radiusKm = 25) {
  return usePolledFeed<RoadFeed>(
    active && !!location,
    () =>
      `${API}/feeds/road-conditions?location=${encodeURIComponent(location)}&radiusKm=${radiusKm}`,
    60000,
    120000,
    25000,
    500,
  );
}

export interface GtfsDeparturesFeed {
  agency: string;
  source: string;
  sourceUrl: string;
  note: string;
  station: string;
  stationId: string;
  updatedAt: string;
  fetchedAt: string;
  items: TransitFeed["items"];
}
/** Open GTFS-realtime departures (agencies with reviewed licences). */
export function useGtfsDepartures(agency: string, station: string, active = true) {
  return usePolledFeed<GtfsDeparturesFeed>(
    active && !!agency && !!station,
    () =>
      `${API}/feeds/gtfs-departures?agency=${encodeURIComponent(agency)}&station=${encodeURIComponent(station)}`,
    30000,
    90000,
    25000,
    300,
  );
}
export function useGtfsAgencies(active = true) {
  return usePolledFeed<{ items: { id: string; name: string; region: string; termsUrl: string }[] }>(
    active,
    () => `${API}/feeds/gtfs-agencies`,
    86400000,
    86400000,
    15000,
  );
}
export function useGtfsStations(agency: string, q: string, active = true) {
  return usePolledFeed<{ agency: string; items: { id: string; name: string }[] }>(
    active && !!agency,
    () => `${API}/feeds/gtfs-stations?agency=${encodeURIComponent(agency)}&q=${encodeURIComponent(q)}`,
    86400000,
    86400000,
    20000,
  );
}
