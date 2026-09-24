/**
 * Storage-allowance numbers, in the operator's units (2026-09-24).
 *
 * "2.3 GB", "50 GB", "412 MB" — binary units, one decimal for GB (none when it
 * is whole), whole MB below 100 MB… exactly the shape the API's
 * `formatStorageBytes` (apps/api/src/assets/storage-quota.service.ts) puts in
 * its 413 message, so the header line and the translated refusal agree with the
 * English server message to the digit. Deliberately NOT the media library's
 * `fmtSize` (two-decimal GB, an em dash for 0): an allowance line reads
 * "0 MB of 10 GB" on an empty library, never "— of 10.00 GB".
 */
const MB = 1024 * 1024;
const GiB = 1024 * MB;

export function formatStorageBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= GiB) {
    const gb = b / GiB;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  if (b >= 100 * MB) return `${(b / GiB).toFixed(1)} GB`;
  return `${b === 0 ? 0 : Math.max(1, Math.round(b / MB))} MB`;
}

/** The 413 `STORAGE_QUOTA_EXCEEDED` body `storageQuotaError` sends; every number in bytes. */
export interface StorageQuotaBody {
  usedBytes: number;
  includedBytes: number;
  neededBytes: number;
}

export const STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED';

/** The three numbers, or null when any is missing — then the server's own sentence is shown as sent. */
export function storageQuotaNumbers(body: unknown): StorageQuotaBody | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const usedBytes = n(b.usedBytes);
  const includedBytes = n(b.includedBytes);
  const neededBytes = n(b.neededBytes);
  if (usedBytes === null || includedBytes === null || neededBytes === null) return null;
  return { usedBytes, includedBytes, neededBytes };
}
