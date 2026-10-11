/**
 * The proof-of-play CSV an operator downloads from /analytics (2026-10-11).
 * Pure, so it is tested without a DOM. Built from the report already on
 * screen — no extra request.
 *
 * Cells are RFC-4180 quoted; any cell a spreadsheet would treat as a formula
 * (= + - @ tab CR) is prefixed with an apostrophe — playlist, asset and
 * screen names are operator-typed data.
 */
import type { ProofOfPlayResponse } from '@/hooks/use-api';

function cell(value: string | number | null | undefined): string {
  let v = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export interface ProofOfPlayCsvLabels {
  type: string;
  name: string;
  hours: string;
  samples: string;
  playlist: string;
  asset: string;
  screen: string;
}

export function proofOfPlayCsv(data: ProofOfPlayResponse, labels: ProofOfPlayCsvLabels): string {
  const lines = [[labels.type, labels.name, labels.hours, labels.samples].map(cell).join(',')];
  const add = (type: string, rows: Array<{ name: string; estimatedHours: number; samples: number }>) => {
    for (const r of rows) {
      lines.push([type, r.name, (Math.round(r.estimatedHours * 100) / 100).toFixed(2), r.samples].map(cell).join(','));
    }
  };
  add(labels.playlist, data.playlists);
  add(labels.asset, data.assets);
  add(labels.screen, data.screens);
  // BOM so Excel opens UTF-8 (accented names) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function proofOfPlayCsvFilename(days: number, now = new Date()): string {
  return `proof-of-play-${days}d-${now.toISOString().slice(0, 10)}.csv`;
}
