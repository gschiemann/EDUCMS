import { deriveCurrentPictureState } from '../playlistOps';

// 2026-10-12: VisionCore dropped 29 of ~2,400 frames (1.2 %, invisible) and a
// freshly published playlist wore "playback problem". Only a visible stutter
// raises the delivery banner.
const now = Date.parse('2026-10-12T13:00:00Z');
const screen = (dropped: number) => ({
  id: 's1', name: 'VisionCore', status: 'ONLINE',
  lastRenderedAt: new Date(now - 10_000).toISOString(),
  lastRenderedHash: 'pl:0|30000|abc|d58fe8',
  authState: 'PROVEN',
  lastVideoReportAt: new Date(now - 10_000).toISOString(),
  lastVideoReport: { at: new Date(now - 10_000).toISOString(), url: 'https://x/a.mp4', totalFrames: 2400, droppedFrames: dropped, stalls: 0 },
}) as any;

describe('deriveCurrentPictureState — video grade', () => {
  it('a 1.2 % hitch is not a playback problem', () => {
    expect(deriveCurrentPictureState(screen(29), now)).toBe('reported');
  });
  it('a visible stutter (> 5 %) is', () => {
    expect(deriveCurrentPictureState(screen(300), now)).toBe('issue');
  });
});
