/**
 * The inline script that keeps a double-sided display's two panes out of each
 * other's localStorage. See faceStorageShim.ts for why it lives at the storage
 * layer instead of at ~17 call sites.
 *
 * What is at stake: the front's device TOKEN and its cached EMERGENCY. A back
 * side that can read or clear either is a fleet-credential bug and a
 * life-safety bug respectively.
 */
import { FACE_STORAGE_MARKER, FACE_STORAGE_SHIM } from '../faceStorageShim';
import { faceKey, MAX_FACE_INDEX } from '../faceStorage';

const ownDesc = Object.getOwnPropertyDescriptor(window, 'localStorage');
const REAL: Storage = window.localStorage;
const stop = jest.fn();

function boot(search: string) {
  window.history.replaceState(null, '', `/player${search}`);
  // eslint-disable-next-line no-new-func
  new Function(FACE_STORAGE_SHIM)();
}

beforeEach(() => {
  // Put the platform's own accessor back, exactly as it was.
  if (ownDesc) Object.defineProperty(window, 'localStorage', ownDesc);
  else delete (window as unknown as Record<string, unknown>).localStorage;
  REAL.clear();
  delete (window as unknown as Record<string, unknown>)[FACE_STORAGE_MARKER];
  document.documentElement.removeAttribute('data-face-storage');
  stop.mockClear();
  (window as unknown as { stop: () => void }).stop = stop;
});

const marker = () => (window as unknown as Record<string, unknown>)[FACE_STORAGE_MARKER];

describe('FACE 0 — the entire existing fleet', () => {
  it.each(['', '?fp=abc&token=t', '?face=0', '?fp=abc&face=0&w=1920'])(
    'does NOTHING for %p: same Storage object, no marker, nothing stopped',
    (search) => {
      boot(search);
      expect(window.localStorage).toBe(REAL);
      expect(marker()).toBeUndefined();
      expect(stop).not.toHaveBeenCalled();
    },
  );
});

describe('FACE 1 — the back side', () => {
  it('cannot SEE the front’s device token, fingerprint or cached emergency', () => {
    REAL.setItem('edu_device_token', 'FRONT-TOKEN');
    REAL.setItem('edu_device_fp', 'android-abc');
    REAL.setItem('edu_emergency_cache_v1', '{"type":"LOCKDOWN"}');
    boot('?face=1&fp=android-abc::face1');

    expect(marker()).toBe(1);
    expect(window.localStorage.getItem('edu_device_token')).toBeNull();
    expect(window.localStorage.getItem('edu_device_fp')).toBeNull();
    expect(window.localStorage.getItem('edu_emergency_cache_v1')).toBeNull();
  });

  it('cannot OVERWRITE the front’s token — its own mint lands in its own slot', () => {
    REAL.setItem('edu_device_token', 'FRONT-TOKEN');
    boot('?face=1');
    window.localStorage.setItem('edu_device_token', 'BACK-TOKEN');

    expect(REAL.getItem('edu_device_token')).toBe('FRONT-TOKEN');
    expect(REAL.getItem(faceKey('edu_device_token', 1))).toBe('BACK-TOKEN');
    expect(window.localStorage.getItem('edu_device_token')).toBe('BACK-TOKEN');
  });

  it('LIFE SAFETY: the back clearing its emergency cache leaves the front’s lockdown cached', () => {
    // The back's ordinary "no alert" manifest calls removeItem on this key.
    REAL.setItem('edu_emergency_cache_v1', '{"type":"LOCKDOWN"}');
    boot('?face=1');
    window.localStorage.removeItem('edu_emergency_cache_v1');
    expect(REAL.getItem('edu_emergency_cache_v1')).toBe('{"type":"LOCKDOWN"}');
  });

  it('clear() wipes ONLY the back’s keys', () => {
    REAL.setItem('edu_device_token', 'FRONT-TOKEN');
    REAL.setItem('edu_canvasW', '1920');
    boot('?face=1');
    window.localStorage.setItem('edu_device_token', 'BACK');
    window.localStorage.setItem('edu_canvasW', '1080');
    window.localStorage.clear();

    expect(REAL.getItem('edu_device_token')).toBe('FRONT-TOKEN');
    expect(REAL.getItem('edu_canvasW')).toBe('1920');
    expect(window.localStorage.getItem('edu_device_token')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('length and key() enumerate only its own keys, under their plain names', () => {
    REAL.setItem('edu_device_token', 'FRONT');
    boot('?face=1');
    window.localStorage.setItem('edu_fitMode', 'cover');
    window.localStorage.setItem('edu_repeats', '2');
    expect(window.localStorage.length).toBe(2);
    const seen = [window.localStorage.key(0), window.localStorage.key(1)].sort();
    expect(seen).toEqual(['edu_fitMode', 'edu_repeats']);
    expect(window.localStorage.key(2)).toBeNull();
  });

  it('two faces are isolated from EACH OTHER, not just from the front', () => {
    boot('?face=1');
    window.localStorage.setItem('edu_device_token', 'FACE-1');
    if (ownDesc) Object.defineProperty(window, 'localStorage', ownDesc);
    else delete (window as unknown as Record<string, unknown>).localStorage;
    boot('?face=2');
    expect(window.localStorage.getItem('edu_device_token')).toBeNull();
    expect(REAL.getItem(faceKey('edu_device_token', 1))).toBe('FACE-1');
  });

  it('uses EXACTLY the key faceKey() defines — the script and the helper cannot drift', () => {
    const keys = [
      'edu_device_token', 'edu_device_fp', 'edu_manifest_cache_v1', 'edu_emergency_cache_v1',
      'edu_refresh_ack', 'edu_canvasW', 'edu_canvasH', 'edu_canvasOrigin', 'edu_posterStandard',
      'edu_fitMode', 'edu_repeats', 'edu_sync_render_lead_v1', 'edu_player_apk_version',
    ];
    for (let n = 1; n <= MAX_FACE_INDEX; n++) {
      if (ownDesc) Object.defineProperty(window, 'localStorage', ownDesc);
      else delete (window as unknown as Record<string, unknown>).localStorage;
      boot(`?face=${n}`);
      for (const k of keys) {
        window.localStorage.setItem(k, `v${n}`);
        expect(REAL.getItem(faceKey(k, n))).toBe(`v${n}`);
      }
    }
  });
});

describe('FAILS CLOSED — never silently the shared store', () => {
  it.each(['?face=9', '?face=4', '?face=abc', '?face=-1', '?face=1.5', '?face=', '?face=1x'])(
    'a bad face param %p stops the document instead of running as the front',
    (search) => {
      REAL.setItem('edu_device_token', 'FRONT-TOKEN');
      boot(search);
      expect(marker()).toBe(-1);
      expect(stop).toHaveBeenCalled();
      expect(document.documentElement.getAttribute('data-face-storage')).toBe('failed');
    },
  );

  it('a platform that refuses the redefinition stops the document too', () => {
    const spy = jest.spyOn(Object, 'defineProperty').mockImplementation(((o: object, p: PropertyKey, d: PropertyDescriptor) => {
      if (o === window && p === 'localStorage') throw new TypeError('not configurable');
      return Reflect.defineProperty(o, p, d) ? o : o;
    }) as typeof Object.defineProperty);
    try {
      boot('?face=1');
    } finally {
      spy.mockRestore();
    }
    expect(marker()).toBe(-1);
    expect(stop).toHaveBeenCalled();
    expect(window.localStorage).toBe(REAL);
  });
});

describe('it must parse on the oldest WebView that will ever host a face', () => {
  it('is ES5: no arrows, const/let, template literals, Proxy, or spread', () => {
    expect(FACE_STORAGE_SHIM).not.toMatch(/=>/);
    expect(FACE_STORAGE_SHIM).not.toMatch(/\b(const|let)\s/);
    expect(FACE_STORAGE_SHIM).not.toMatch(/`/);
    expect(FACE_STORAGE_SHIM).not.toMatch(/\bProxy\b|\.\.\./);
  });
});
