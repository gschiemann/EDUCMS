import { deleteAssetsInBatches } from '../asset-bulk-delete';
const apiFetch = jest.fn();
jest.mock('../api-client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
beforeEach(() => apiFetch.mockReset());
it('uses bounded requests and one outcome for every unique selected file', async () => {
  const ids = Array.from({ length: 43 }, (_, i) => String(i));
  apiFetch.mockImplementation(async (_path: string, options: { body: string }) => ({ results: JSON.parse(options.body).ids.map((id: string) => ({ id, deleted: id !== '2', code: id === '2' ? 'ASSET_IN_EMERGENCY_CONTENT' : undefined })) }));
  const result = await deleteAssetsInBatches({ ids: [...ids, '1'], confirmInUse: true });
  expect(apiFetch.mock.calls.map(call => JSON.parse(call[1].body).ids.length)).toEqual([20, 20, 3]);
  expect(apiFetch.mock.calls.every(call => call[0] === '/assets/bulk-delete?confirm=in-use' && call[1]._noRetry)).toBe(true);
  expect(result.results).toHaveLength(43);
  expect(result.results[2]).toMatchObject({ deleted: false, code: 'ASSET_IN_EMERGENCY_CONTENT' });
});
it('a lost response is unknown, never automatically retried or reported deleted', async () => {
  apiFetch.mockRejectedValue(new Error('connection lost'));
  const result = await deleteAssetsInBatches({ ids: Array.from({ length: 21 }, (_, i) => String(i)), confirmInUse: false });
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch.mock.calls[0][0]).toBe('/assets/bulk-delete');
  expect(result.results[0].code).toBe('DELETE_NOT_CONFIRMED');
  expect(result.results[20].code).toBe('DELETE_NOT_STARTED');
  expect(result.results.some(item => item.deleted)).toBe(false);
});
it('an incomplete server receipt never invents success for missing ids', async () => {
  apiFetch.mockResolvedValue({ results: [{ id: 'one', deleted: true }] });
  const result = await deleteAssetsInBatches({ ids: ['one', 'two'], confirmInUse: true });
  expect(result.results[1]).toMatchObject({ id: 'two', deleted: false, code: 'DELETE_NOT_CONFIRMED' });
});
