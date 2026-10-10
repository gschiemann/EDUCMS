/**
 * The setup-links CSV an administrator downloads to hand each location its
 * one-time sign-in link (2026-10-10). Pure, so it is tested without a DOM.
 *
 * Cells are RFC-4180 quoted, and any cell a spreadsheet would treat as a
 * formula (= + - @ tab CR) is prefixed with an apostrophe — a location name is
 * operator-typed data, and CSV injection is the classic way such a file bites
 * the person who opens it.
 */
export type SetupLinkCsvRow = {
  location: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  url: string;
  expiresAt: string;
};

function cell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function setupLinksCsv(
  rows: SetupLinkCsvRow[],
  headers: { location: string; name: string; currentEmail: string; role: string; link: string; expires: string },
): string {
  const head = [headers.location, headers.name, headers.currentEmail, headers.role, headers.link, headers.expires];
  const lines = [head.map(cell).join(',')];
  for (const r of rows) {
    const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
    lines.push([r.location, name, r.email, r.role, r.url, r.expiresAt.slice(0, 10)].map(cell).join(','));
  }
  // BOM so Excel opens UTF-8 (accented location names) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function setupLinksCsvFilename(now = new Date()): string {
  return `setup-links-${now.toISOString().slice(0, 10)}.csv`;
}
