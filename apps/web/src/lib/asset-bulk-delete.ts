import { apiFetch } from './api-client';

export type BulkAssetDeleteTarget = { ids: string[]; confirmInUse: boolean };
export type AssetDeleteResult = { id: string; deleted: boolean; code?: string; message?: string };
export const isBulkAssetDelete = (value: unknown): value is BulkAssetDeleteTarget =>
  !!value && typeof value === 'object' && Array.isArray((value as BulkAssetDeleteTarget).ids);

/** Short, bounded requests. Never retry a mutation whose result is unknown. */
export async function deleteAssetsInBatches(target: BulkAssetDeleteTarget): Promise<{ results: AssetDeleteResult[] }> {
  const ids = [...new Set(target.ids)];
  const results: AssetDeleteResult[] = [];
  for (let start = 0; start < ids.length; start += 20) {
    const chunk = ids.slice(start, start + 20);
    try {
      const reply = await apiFetch<{ results: AssetDeleteResult[] }>(
        '/assets/bulk-delete' + (target.confirmInUse ? '?confirm=in-use' : ''),
        { method: 'POST', body: JSON.stringify({ ids: chunk }), _noRetry: true },
      );
      for (const id of chunk) {
        const result = Array.isArray(reply?.results) ? reply.results.find(item => item.id === id && typeof item.deleted === 'boolean') : null;
        results.push(result || { id, deleted: false, code: 'DELETE_NOT_CONFIRMED', message: "Refresh to see what's left." });
      }
    } catch {
      // A lost response may follow a committed deletion. Report uncertainty;
      // restore the list and let the final refetch establish the actual state.
      results.push(...chunk.map(id => ({ id, deleted: false, code: 'DELETE_NOT_CONFIRMED', message: "Refresh to see what's left." })));
      results.push(...ids.slice(start + 20).map(id => ({ id, deleted: false, code: 'DELETE_NOT_STARTED', message: 'Try again.' })));
      break;
    }
  }
  return { results };
}
