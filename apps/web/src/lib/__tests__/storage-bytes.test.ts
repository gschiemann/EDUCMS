/**
 * storage-bytes (2026-09-24) — the web twin of the API's `formatStorageBytes`
 * (apps/api/src/assets/storage-quota.service.ts). The header line and the
 * translated 413 must print the same digits the server's English sentence
 * prints from the same numbers; the producer-cut body below is that sentence.
 */
import { formatStorageBytes, storageQuotaNumbers } from '../storage-bytes';

const MB = 1024 * 1024;
const GiB = 1024 * MB;

// Cut from storageQuotaError(): 10 screens (50 GB), 49.6 GB stored, a 0.9 GB file.
const PRODUCER = {
  message: 'This file needs 0.9 GB; 0.4 GB of your 50 GB is left — delete unused media or add screens.',
  usedBytes: 53257594470,
  includedBytes: 53687091200,
  neededBytes: 966367642,
};

describe('formatStorageBytes', () => {
  it('prints the numbers the producer printed, from the same bytes', () => {
    const left = PRODUCER.includedBytes - PRODUCER.usedBytes;
    const need = formatStorageBytes(PRODUCER.neededBytes);
    const rest = formatStorageBytes(left);
    const total = formatStorageBytes(PRODUCER.includedBytes);
    expect([need, rest, total]).toEqual(['0.9 GB', '0.4 GB', '50 GB']);
    expect(PRODUCER.message).toBe(`This file needs ${need}; ${rest} of your ${total} is left — delete unused media or add screens.`);
  });

  it('binary units: one decimal for GB (none when whole), whole MB below 100 MB, "0 MB" for nothing', () => {
    expect(formatStorageBytes(0)).toBe('0 MB');
    expect(formatStorageBytes(1)).toBe('1 MB');
    expect(formatStorageBytes(412 * MB)).toBe('0.4 GB');
    expect(formatStorageBytes(64 * MB)).toBe('64 MB');
    expect(formatStorageBytes(Math.round(2.3 * GiB))).toBe('2.3 GB');
    expect(formatStorageBytes(10 * GiB)).toBe('10 GB');
    expect(formatStorageBytes(-5)).toBe('0 MB');
    expect(formatStorageBytes(Number.NaN)).toBe('0 MB');
  });
});

describe('storageQuotaNumbers', () => {
  it('reads the three byte counts from a 413 body', () => {
    expect(storageQuotaNumbers(PRODUCER)).toEqual({
      usedBytes: 53257594470,
      includedBytes: 53687091200,
      neededBytes: 966367642,
    });
  });

  it('is null when any number is missing, negative or not a number — then the server sentence is shown as sent', () => {
    const missing: Record<string, unknown> = { ...PRODUCER };
    delete missing.neededBytes;
    expect(storageQuotaNumbers(missing)).toBeNull();
    expect(storageQuotaNumbers({ ...PRODUCER, usedBytes: -1 })).toBeNull();
    expect(storageQuotaNumbers({ ...PRODUCER, includedBytes: '50 GB' })).toBeNull();
    expect(storageQuotaNumbers(null)).toBeNull();
    expect(storageQuotaNumbers('STORAGE_QUOTA_EXCEEDED')).toBeNull();
  });
});
