import { render, cleanup } from '@testing-library/react';
import { useEmergencyPaintMonitor, type EmergencyPaintMonitorRefs } from '../emergencyPaintMonitor';
import { broadcastCanvasTransform, nativeSiteViewRect, publishBroadcastLayout, resetNativeBannerSupportForTest } from '../broadcastLayout';
import { nativeCall } from '../nativeBridge';

// 2026-11-24 — the review of the emergency-over-broadcast change: the page
// learned "this app transforms its native site views under a banner itself"
// (sharedVideoState.broadcastBannerVersion) from ONE boot read. If that read
// timed out or answered late, a field build got the glass rectangle for the
// whole document: the site shrunk and shifted twice after an all-clear. The
// paint monitor already reads sharedVideoState while any emergency root is up
// (the held banner included), so it now feeds the same note.
jest.mock('../nativeBridge', () => ({
  nativeHas: () => true,
  hasNativeBridge: () => true,
  apkVersionFromUserAgent: () => null,
  nativeCall: jest.fn(),
  nativeFire: jest.fn(),
}));
jest.mock('../emergencyHold', () => ({ reassertDisplayEmergencyHold: jest.fn(), bannerRefusalFromState: jest.fn(() => null), noteNativeBannerRefused: jest.fn() }));

const layout = { width: 1920, height: 1080, bannerHeight: 108 };
const t = broadcastCanvasTransform(layout)!;
const glass = { left: t.left, top: t.top + 96 * t.scale, width: 1920 * t.scale, height: 984 * t.scale };

function mountMonitor() {
  const refs: EmergencyPaintMonitorRefs = { watcher: { current: null }, expectedIdentity: { current: 'held-banner' }, screenId: { current: 'test-screen' }, manifestOkAt: { current: 0 } };
  const post = jest.fn().mockResolvedValue(200);
  function Monitor() { useEmergencyPaintMonitor(refs, { disabled: () => false, post }); return null; }
  return render(<Monitor />);
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  publishBroadcastLayout(layout);
});
afterEach(() => { cleanup(); publishBroadcastLayout(null); resetNativeBannerSupportForTest(); jest.restoreAllMocks(); (nativeCall as jest.Mock).mockReset(); });

it('a field build that reports broadcastBannerVersion on the paint read gets canvas coordinates, even with no boot read', async () => {
  (nativeCall as jest.Mock).mockResolvedValue(JSON.stringify({ broadcastBannerVersion: 1, emergencyProof: { challenge: 'c1', status: 'pending' } }));
  expect(nativeSiteViewRect(glass)).toBe(glass);
  const mounted = mountMonitor();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nativeCall).toHaveBeenCalledWith('sharedVideoState');
  const canvas = nativeSiteViewRect(glass);
  expect(canvas.left).toBeCloseTo(0, 6);
  expect(canvas.top).toBeCloseTo(96, 6);
  expect(canvas.width).toBeCloseTo(1920, 6);
  expect(canvas.height).toBeCloseTo(984, 6);
  mounted.unmount();
});

it('an app that does not report it (stable 1.1.29) keeps the glass rectangle', async () => {
  (nativeCall as jest.Mock).mockResolvedValue(JSON.stringify({ emergencyProof: { challenge: 'c1', status: 'pending' } }));
  const mounted = mountMonitor();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nativeCall).toHaveBeenCalledWith('sharedVideoState');
  expect(nativeSiteViewRect(glass)).toBe(glass);
  mounted.unmount();
});
