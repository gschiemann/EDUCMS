import {
  appliedBroadcastLayout, broadcastCanvasTransform, broadcastContentStyle, canvasRectFromGlass, nativeSiteViewRect,
  noteNativeBannerSupport, publishBroadcastLayout, resetNativeBannerSupportForTest,
} from '../broadcastLayout';

it('scales the original landscape canvas below the banner without resizing its layout viewport', () => {
  expect(broadcastContentStyle({ width: 1920, height: 1080, bannerHeight: 108 })).toEqual({ top: 108, left: expect.closeTo(96), transform: 'scale(0.9)', transformOrigin: 'top left' });
});
it('caps a long banner at 40 percent and preserves portrait and ribbon content', () => {
  for (const [width, height] of [[1080, 1920], [320, 1080], [1920, 160]]) {
    const style = broadcastContentStyle({ width, height, bannerHeight: height });
    expect(style.top).toBe(height * 0.4);
    expect(style.transform).toBe('scale(0.6)');
  }
});
it('restores the same original canvas after clear', () => {
  expect(broadcastContentStyle(null)).toEqual({});
  expect(broadcastContentStyle({ width: 0, height: 0, bannerHeight: 100 })).toEqual({});
});

describe('canvas coordinates for a native view the APK transforms itself (2026-11-23, Website Tabs after an all-clear)', () => {
  afterEach(() => { publishBroadcastLayout(null); resetNativeBannerSupportForTest(); });

  it('the style and the transform are one formula', () => {
    expect(broadcastCanvasTransform({ width: 1920, height: 1080, bannerHeight: 108 })).toEqual({ top: 108, left: expect.closeTo(96), scale: expect.closeTo(0.9) });
    expect(broadcastCanvasTransform(null)).toBeNull();
  });

  it('undoes exactly the applied banner transform, so the APK applying it again lands the site where the page drew it', () => {
    const layout = { width: 1920, height: 1080, bannerHeight: 108 };
    const t = broadcastCanvasTransform(layout)!;
    const canvas = { left: 0, top: 72, width: 1920, height: 1008 };
    // What getBoundingClientRect reports under the banner…
    const glass = { left: t.left + canvas.left * t.scale, top: t.top + canvas.top * t.scale, width: canvas.width * t.scale, height: canvas.height * t.scale };
    publishBroadcastLayout(layout);
    expect(appliedBroadcastLayout()).toBe(layout);
    const back = canvasRectFromGlass(glass);
    for (const k of ['left', 'top', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(canvas[k], 6);
    // …and the APK's own transform of that rectangle (BroadcastContentViews.apply) is the glass rectangle again.
    expect(t.left + back.left * t.scale).toBeCloseTo(glass.left, 6);
    expect(t.top + back.top * t.scale).toBeCloseTo(glass.top, 6);
  });

  it('no banner: the rectangle is unchanged', () => {
    const r = { left: 10, top: 20, width: 300, height: 400 };
    expect(canvasRectFromGlass(r)).toEqual(r);
    expect(canvasRectFromGlass(r, { width: 0, height: 0, bannerHeight: 10 })).toEqual(r);
  });

  it('only an app that transforms its site views itself gets canvas coordinates; any other app keeps the glass rectangle', () => {
    const layout = { width: 1920, height: 1080, bannerHeight: 108 };
    const t = broadcastCanvasTransform(layout)!;
    const glass = { left: t.left, top: t.top + 96 * t.scale, width: 1920 * t.scale, height: 984 * t.scale };
    publishBroadcastLayout(layout);
    // Stable 1.1.29 (Website Tabs, no BroadcastContentViews), a browser, or no reply yet: as before.
    expect(nativeSiteViewRect(glass)).toBe(glass);
    noteNativeBannerSupport(JSON.stringify({ broadcastBannerVersion: 0 }));
    noteNativeBannerSupport('not json');
    noteNativeBannerSupport({ broadcastBannerVersion: '1' });
    noteNativeBannerSupport(null);
    expect(nativeSiteViewRect(glass)).toBe(glass);
    // A field build that reports broadcastBannerVersion ≥ 1 transforms the view itself.
    noteNativeBannerSupport(JSON.stringify({ broadcastBannerVersion: 1, device: {} }));
    const canvas = nativeSiteViewRect(glass);
    expect(canvas.left).toBeCloseTo(0, 6);
    expect(canvas.top).toBeCloseTo(96, 6);
    expect(canvas.width).toBeCloseTo(1920, 6);
    expect(canvas.height).toBeCloseTo(984, 6);
    // It never turns back off within a document, and with no banner the rectangle is unchanged.
    noteNativeBannerSupport({ broadcastBannerVersion: 0 });
    publishBroadcastLayout(null);
    expect(nativeSiteViewRect(glass)).toEqual(glass);
  });
});
