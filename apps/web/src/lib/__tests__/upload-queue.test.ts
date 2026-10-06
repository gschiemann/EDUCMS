import { createUploadQueue } from '../upload-queue';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

it('serializes mobile uploads across separate selections, even after one fails', async () => {
  const queue = createUploadQueue(() => 1);
  const started: number[] = [];
  const finish: Array<() => void> = [];
  const job = (id: number, fail = false) => async () => {
    started.push(id);
    await new Promise<void>((resolve) => finish.push(resolve));
    if (fail) throw new Error('Storage unavailable');
  };
  queue.add([job(1, true), job(2)]);
  queue.add([job(3), job(4)]);
  await flush();
  expect(started).toEqual([1]);
  for (let i = 0; i < 3; i++) {
    finish[i]();
    await flush();
    expect(started).toEqual(Array.from({ length: i + 2 }, (_, j) => j + 1));
  }
  finish[3]();
  await flush();
});

it('clears waiting uploads when the page leaves and honors desktop concurrency', async () => {
  const queue = createUploadQueue(() => 3);
  const started: number[] = [];
  const finish: Array<() => void> = [];
  queue.add([1, 2, 3, 4, 5].map((id) => async () => {
    started.push(id);
    await new Promise<void>((resolve) => finish.push(resolve));
  }));
  await flush();
  expect(started).toEqual([1, 2, 3]);
  queue.clear();
  finish.forEach((resolve) => resolve());
  await flush();
  expect(started).toEqual([1, 2, 3]);
});
