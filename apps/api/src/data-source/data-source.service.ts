/**
 * DataSourceService — Phase 3 "Custom data" feed normalizer.
 *
 * Fetches an operator-supplied URL SERVER-SIDE (so the player/browser
 * never makes a cross-origin call, and so the URL flows through our
 * SSRF gate) and normalizes the response into a flat list of string
 * maps: Array<Record<string,string>>. Generic widgets (TICKER, etc.)
 * render those rows by picking a column.
 *
 * SSRF: every outbound fetch goes through `safeFetch` from
 * ../branding/safe-fetch — which validates scheme/port/IP-literal,
 * DNS-resolves and rejects private/loopback/link-local addresses, pins
 * the connect-time lookup (DNS-rebind-proof), follows at most 3
 * redirects re-validating each hop, and enforces a byte cap + timeout.
 * We NEVER call global fetch() here.
 *
 * Caps: a small maxBytes (default ~1.5MB) + an 8s timeout via
 * safeFetch, plus a hard cap on the number of rows + columns we return
 * so a hostile-but-public feed can't blow up the builder. We also never
 * surface raw response bodies to logs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { safeFetch } from '../branding/safe-fetch';

export type CustomDataFormat = 'json' | 'csv';

export interface CustomDataResult {
  rows: Array<Record<string, string>>;
  /** The column keys present across the returned rows (stable order). */
  columns: string[];
  /** How many rows the source actually had before we capped (for UX). */
  totalRows: number;
  format: CustomDataFormat;
}

// Hard ceilings so a public-but-huge feed can't blow up the builder or
// the player. These are independent of the byte cap (a 1.5MB CSV can
// still be tens of thousands of rows of two short columns).
const MAX_ROWS = 500;
const MAX_COLS = 40;
const MAX_CELL_LEN = 2000;
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024; // 1.5 MB
const DEFAULT_TIMEOUT_MS = 8000;

@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  /**
   * Fetch + normalize. Throws `SsrfError` (from safe-fetch) on a
   * disallowed/internal URL — the controller maps that to a 400 with a
   * generic, non-leaking message. Throws a plain Error on parse
   * failures (controller maps to 422).
   */
  async fetchNormalized(rawUrl: string, format: CustomDataFormat): Promise<CustomDataResult> {
    // safeFetch enforces scheme/port/IP + DNS-rebind pin + redirect
    // re-validation + byte cap + timeout. Anything it rejects throws
    // SsrfError / FetchTooLargeError BEFORE the controller sees a body.
    const res = await safeFetch(rawUrl, {
      maxBytes: DEFAULT_MAX_BYTES,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      accept: format === 'csv' ? 'text/csv, text/plain, */*' : 'application/json, */*',
    });

    // Decode to text. safeFetch already gunzip/deflate/br-decoded.
    const text = res.body.toString('utf8');

    let parsed: Array<Record<string, string>>;
    if (format === 'csv') {
      parsed = parseCsv(text);
    } else {
      parsed = parseJson(text);
    }

    const totalRows = parsed.length;

    // Cap rows, then derive a stable column order (first-seen across the
    // kept rows), then cap columns + cell length. We coerce EVERY value
    // to a string so the consumer side never has to defend against
    // nested objects/arrays leaking through.
    const kept = parsed.slice(0, MAX_ROWS);
    const seen: string[] = [];
    const seenSet = new Set<string>();
    for (const row of kept) {
      for (const k of Object.keys(row)) {
        if (!seenSet.has(k)) {
          seenSet.add(k);
          seen.push(k);
          if (seen.length >= MAX_COLS) break;
        }
      }
      if (seen.length >= MAX_COLS) break;
    }
    const columns = seen.slice(0, MAX_COLS);
    const colSet = new Set(columns);

    const rows: Array<Record<string, string>> = kept.map((row) => {
      const out: Record<string, string> = {};
      for (const k of Object.keys(row)) {
        if (!colSet.has(k)) continue;
        let v = row[k];
        if (v == null) v = '';
        if (typeof v !== 'string') v = String(v);
        if (v.length > MAX_CELL_LEN) v = v.slice(0, MAX_CELL_LEN);
        out[k] = v;
      }
      return out;
    });

    // Intentionally do NOT log the body or full URL at info level —
    // anti-exfil + don't write a tenant's third-party feed contents to
    // our logs. A row count is safe signal for debugging.
    this.logger.debug(`Custom-data ${format} normalized: ${rows.length}/${totalRows} rows, ${columns.length} cols`);

    return { rows, columns, totalRows, format };
  }
}

/**
 * Parse a JSON document into a flat list of string maps.
 * Accepts:
 *   - a top-level array of objects → those rows
 *   - a top-level array of scalars → [{ value: "..." }, ...]
 *   - an object with exactly ONE array-valued property → that array
 *     (the common `{ "items": [...] }` / `{ "data": [...] }` shape)
 *   - a single object → one row
 * Each row is flattened ONE level deep — nested objects/arrays are
 * JSON-stringified into a single cell so the consumer always gets a
 * flat string map. (The service then re-coerces every cell to string.)
 */
function parseJson(text: string): Array<Record<string, string>> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Response was not valid JSON');
  }

  const toRow = (v: unknown): Record<string, string> => {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[String(k)] = flattenCell(val);
      }
      return out;
    }
    // Scalar (or array) row → single "value" column.
    return { value: flattenCell(v) };
  };

  if (Array.isArray(doc)) {
    return doc.map(toRow);
  }

  if (doc != null && typeof doc === 'object') {
    const obj = doc as Record<string, unknown>;
    const arrayProps = Object.entries(obj).filter(([, v]) => Array.isArray(v));
    if (arrayProps.length === 1) {
      return (arrayProps[0][1] as unknown[]).map(toRow);
    }
    // Prefer a conventionally-named array if several exist.
    const preferred = ['data', 'items', 'results', 'rows', 'records', 'entries'];
    for (const name of preferred) {
      if (Array.isArray(obj[name])) {
        return (obj[name] as unknown[]).map(toRow);
      }
    }
    // No obvious array → treat the object itself as a single row.
    return [toRow(obj)];
  }

  throw new Error('JSON did not contain an array of rows or an object');
}

function flattenCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Parse a CSV document (Google Sheets "Publish to web → CSV" output, or
 * any RFC-4180-ish CSV) into rows keyed by the header row. Handles
 * quoted fields, embedded commas, embedded newlines inside quotes, and
 * doubled-quote escaping (`""` → `"`). Tolerant of both `\r\n` and `\n`.
 *
 * Hand-rolled (no dependency) so we don't add a CSV lib for a single
 * endpoint. Bounded by the byte cap already applied by safeFetch.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const records = tokenizeCsv(text);
  if (records.length === 0) return [];

  const header = records[0].map((h, i) => {
    const name = (h ?? '').trim();
    return name.length > 0 ? name : `col${i + 1}`;
  });

  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // Skip fully-empty trailing lines (common when a sheet ends in \n).
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = cells[c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/** Tokenize CSV text into an array of field-arrays (one per record). */
function tokenizeCsv(text: string): string[][] {
  const out: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    out.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Handle CRLF as a single record boundary.
      if (text[i + 1] === '\n') i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field/record if the file didn't end with a newline.
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }
  return out;
}
