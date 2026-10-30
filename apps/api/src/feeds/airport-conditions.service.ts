import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { PublicSourceCache } from './public-source-cache';
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any) =>
  String(v?.['#text'] ?? v ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .slice(0, 1000);
export interface AirportNotice {
  airport: string;
  type: string;
  reason: string;
  average: string;
  maximum: string;
  minimum: string;
  trend: string;
  start: string;
  end: string;
}
export function parseAirportConditions(body: string, now = Date.now()) {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    processEntities: false,
  }).parse(body)?.AIRPORT_STATUS_INFORMATION;
  const at = Date.parse(text(parsed?.Update_Time));
  if (!Number.isFinite(at) || at < now - 30 * 60000 || at > now + 5 * 60000)
    throw new Error('No fresh FAA update');
  const items: AirportNotice[] = [];
  const add = (raw: any, type: string) => {
    const airport = text(raw?.ARPT).toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(airport)) return;
    const event = raw.Arrival_Departure || raw;
    items.push({
      airport,
      type,
      reason: text(raw.Reason),
      average: text(raw.Avg),
      maximum: text(raw.Max || event.Max),
      minimum: text(event.Min),
      trend: text(event.Trend),
      start: text(raw.Start),
      end: text(raw.Reopen || raw.End_Time),
    });
  };
  for (const kind of array(parsed?.Delay_type)) {
    for (const row of array(kind.Ground_Delay_List?.Ground_Delay))
      add(row, 'Ground delay program');
    for (const row of array(kind.Ground_Stop_List?.Ground_Stop))
      add(row, 'Ground stop');
    for (const row of array(kind.Arrival_Departure_Delay_List?.Delay))
      add(
        row,
        `${text(row.Arrival_Departure?.Type) || 'Arrival / departure'} delays`,
      );
    // These often restrict only non-scheduled general aviation. Preserve the
    // exact notice; never promote a restriction to "all flights cancelled".
    for (const row of array(kind.Airport_Closure_List?.Airport))
      add(row, 'Closure / restriction notice');
  }
  return { updatedAt: new Date(at).toISOString(), items: items.slice(0, 300) };
}
@Injectable()
export class AirportConditionsService {
  constructor(private readonly sources: PublicSourceCache) {}
  async get(airport: string) {
    try {
      const data = await this.sources.read(
        'faa-nas-status',
        'https://nasstatus.faa.gov/api/airport-status-information',
        120,
        parseAirportConditions,
      );
      if (Date.parse(data.value.updatedAt) < Date.now() - 30 * 60000)
        throw new Error('Old source');
      return {
        source: 'FAA NAS Status',
        sourceUrl: 'https://nasstatus.faa.gov/',
        airport,
        updatedAt: data.value.updatedAt,
        fetchedAt: data.fetchedAt,
        items: airport
          ? data.value.items.filter((r) => r.airport === airport)
          : data.value.items,
      };
    } catch {
      throw new ServiceUnavailableException(
        'FAA airport conditions temporarily unavailable.',
      );
    }
  }
}
