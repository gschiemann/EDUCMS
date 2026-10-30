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
  source: string;
  sourceUrl: string;
  region: string;
  location: string;
  supported: boolean;
  reason?: string;
  fetchedAt: string;
  items: {
    id: string;
    type: string;
    road: string;
    area: string;
    distanceKm: number;
  }[];
}
export function useRoadIncidents(location: string, active = true) {
  return usePolledFeed<RoadFeed>(
    active && !!location,
    () =>
      `${API}/feeds/road-incidents?location=${encodeURIComponent(location)}`,
    60000,
    120000,
    25000,
    500,
  );
}
