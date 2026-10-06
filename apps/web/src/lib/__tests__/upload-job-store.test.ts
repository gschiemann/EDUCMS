import { clearUploadJobs, enqueueUploadJob, updateUploadItems, useUploadJobStore, type UploadItem } from '../upload-job-store';
import { useUIStore } from '@/store/ui-store';

const identity = (tenantId = 'alpha', id = 'operator') => useUIStore.setState({ user: { id, tenantId } as never });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const item = (id: string): UploadItem => ({ id, file: new File(['video'], `${id}.mp4`, { type: 'video/mp4' }), phase: 'idle', progress: 0, ownerUserId: 'operator', ownerTenantId: 'alpha', folderId: 'folder' });
beforeEach(() => { clearUploadJobs(useUploadJobStore.getState().items.map(i => i.id)); identity(); });
afterEach(async () => { clearUploadJobs(useUploadJobStore.getState().items.map(i => i.id)); await settle(); });

it('keeps three video transfers active across batches and only starts queued jobs as slots finish', async () => {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  updateUploadItems(() => Array.from({ length: 5 }, (_, i) => item(String(i))));
  for (const row of useUploadJobStore.getState().items) enqueueUploadJob(row.id, async signal => {
    started.push(row.id);
    await new Promise<void>(resolve => { releases.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); });
  });
  await settle();
  expect(started).toEqual(['0', '1', '2']);
  releases[0](); await settle();
  expect(started).toEqual(['0', '1', '2', '3']);
  releases[1](); await settle();
  expect(started).toEqual(['0', '1', '2', '3', '4']);
});

it('Clear aborts active jobs and discards queued jobs without starting them', async () => {
  const signals: AbortSignal[] = [];
  updateUploadItems(() => Array.from({ length: 5 }, (_, i) => item(String(i))));
  for (const row of useUploadJobStore.getState().items) enqueueUploadJob(row.id, signal => new Promise(resolve => {
    signals.push(signal); signal.addEventListener('abort', () => resolve(), { once: true });
  }));
  await settle(); clearUploadJobs(['0', '1', '2', '3', '4']); await settle();
  expect(signals).toHaveLength(3);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(useUploadJobStore.getState().items).toEqual([]);
});

it('pauses an original location on account switch and resumes only when that owner returns', async () => {
  const signals: AbortSignal[] = [];
  updateUploadItems(() => [item('one')]);
  enqueueUploadJob('one', signal => new Promise(resolve => {
    signals.push(signal); signal.addEventListener('abort', () => resolve(), { once: true });
  }));
  await settle(); identity('beta'); await settle();
  expect(signals[0].aborted).toBe(true);
  expect(useUploadJobStore.getState().items[0]).toMatchObject({ paused: true, ownerTenantId: 'alpha' });
  expect(signals).toHaveLength(1);
  identity('alpha'); await settle();
  expect(signals).toHaveLength(2);
  expect(signals[1].aborted).toBe(false);
});

it('logout discards files so another operator cannot resume or see them', async () => {
  updateUploadItems(() => [item('one')]);
  const run = jest.fn(async () => {});
  enqueueUploadJob('one', run);
  useUIStore.setState({ user: null });
  await settle(); identity('alpha', 'someone-else'); await settle();
  expect(run).not.toHaveBeenCalled();
  expect(useUploadJobStore.getState().items).toEqual([]);
});

it('removing a row through Clear done also releases its runner', async () => {
  updateUploadItems(() => [item('one')]);
  const run = jest.fn(async () => {});
  enqueueUploadJob('one', run);
  updateUploadItems(() => []);
  await settle();
  expect(run).not.toHaveBeenCalled();
});
