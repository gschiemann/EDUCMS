/** Browser-origin estimates only; these do not measure Android disk/native media. */
export type PlayerStorageEstimate = { usage: number; quota: number };

export async function readPlayerStorageEstimate(storage?: Pick<StorageManager, 'estimate'>): Promise<PlayerStorageEstimate | null> {
  try {
    if (!storage || typeof storage.estimate !== 'function') return null;
    const { usage, quota } = await storage.estimate();
    return typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 &&
      typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? { usage, quota } : null;
  } catch { return null; }
}

export function storageEstimateText(estimate: PlayerStorageEstimate | null) {
  if (!estimate) return null;
  const format = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1) return '<1 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${Number((bytes / Math.pow(1024, unit)).toFixed(2))} ${units[unit]}`;
  };
  return {
    used: format(estimate.usage), total: format(estimate.quota),
    percent: Math.max(0, Math.min(100, (estimate.usage / estimate.quota) * 100)),
  };
}
