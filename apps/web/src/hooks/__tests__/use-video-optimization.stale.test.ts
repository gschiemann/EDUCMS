import { optimizationOf, type VideoOptimization } from '../use-video-optimization';

describe('a finished job on the asset beats a stale "running" poll answer (2026-10-12)', () => {
  const running: VideoOptimization = { status: 'running', reason: null, progress: null, sourceBytes: null, outputBytes: null, finishedAt: null };
  it('list says done, poll says running → done', () => {
    const live = new Map([['a1', running]]);
    expect(optimizationOf({ id: 'a1', transcodeJob: { status: 'done', progress: 100 } }, live)?.status).toBe('done');
  });
  it('list still running → live progress is used', () => {
    const live = new Map([['a1', { ...running, progress: 40 }]]);
    expect(optimizationOf({ id: 'a1', transcodeJob: { status: 'running' } }, live)?.progress).toBe(40);
  });
});
