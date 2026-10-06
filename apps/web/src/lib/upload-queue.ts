/** One concurrency limit across every batch added to a library page. */
export function createUploadQueue(limit: () => number) {
  const pending: Array<() => Promise<void>> = [];
  let active = 0;
  const drain = () => {
    while (active < limit() && pending.length) {
      const job = pending.shift()!;
      active += 1;
      void Promise.resolve().then(job).catch(() => {}).finally(() => {
        active -= 1;
        drain();
      });
    }
  };
  return {
    add(jobs: Array<() => Promise<void>>) { pending.push(...jobs); drain(); },
    clear() { pending.length = 0; },
  };
}
