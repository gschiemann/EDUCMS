import { DISPLAY_BLANK_EVENT, isDisplayBlanked, nativeWebsiteTarget, publishDisplayBlank, type NativeWebsiteInput } from '../displayBlankSignal';

const site = { asset: { mimeType: 'text/html', fileUrl: 'https://menu.example/today' } };
const on: NativeWebsiteInput = { playing: true, playbackStopped: false, emergency: false, blanked: false, item: site, itemValid: true, apiRoot: 'https://api.example' };

describe('the native website view for a playlist item', () => {
  it('shows the site while it is the item on glass', () => {
    expect(nativeWebsiteTarget(on)).toBe('https://menu.example/today');
    expect(nativeWebsiteTarget({ ...on, item: { asset: { mimeType: 'text/html', fileUrl: '/api/v1/assets/file/page' } } }))
      .toBe('https://api.example/api/v1/assets/file/page');
  });

  // The 2026-10-03 report: "when a website is published to a screen, it ignores
  // the blank and wake functions". The black cover is in the page; the site is a
  // native view above the page.
  it('is taken down while the screen is blanked, and comes back on wake', () => {
    expect(nativeWebsiteTarget({ ...on, blanked: true })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, blanked: false })).toBe('https://menu.example/today');
  });

  it('is hidden for every other reason nothing of the playlist should be on glass', () => {
    expect(nativeWebsiteTarget({ ...on, playing: false })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, playbackStopped: true })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, emergency: true })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, itemValid: false })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, item: null })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, item: { asset: { mimeType: 'video/mp4', fileUrl: 'https://cdn.example/a.mp4' } } })).toBeNull();
    expect(nativeWebsiteTarget({ ...on, item: { asset: { mimeType: 'text/html', fileUrl: 'javascript:alert(1)' } }, apiRoot: '' })).toBeNull();
  });
});

describe('the blank signal widgets listen to', () => {
  afterEach(() => publishDisplayBlank(false));

  it('says whether the screen is blanked, and announces every change', () => {
    const seen: boolean[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent<{ on: boolean }>).detail.on);
    window.addEventListener(DISPLAY_BLANK_EVENT, listen);
    expect(isDisplayBlanked()).toBe(false);
    publishDisplayBlank(true);
    expect(isDisplayBlanked()).toBe(true);
    publishDisplayBlank(false);
    expect(isDisplayBlanked()).toBe(false);
    window.removeEventListener(DISPLAY_BLANK_EVENT, listen);
    expect(seen).toEqual([true, false]);
  });
});
