/**
 * hardware-detect — the LED-poster signature and the coarse-bucket upgrade
 * (2026-09-01, LED poster field install).
 *
 * Two paired NovaStar TB posters sat in `generic-android` for a week: their
 * WebView UA carries the Rockchip reference strings (`rk356x_box`, Chromium
 * 83) and no "Taurus"/"NovaStar" marker, and `inferIfUnknown` refused every
 * later register call because the column already had a value. That hid the
 * dashboard's LED canvas controls and left a 320-wide poster sized to the
 * controller's 600-minimum OS resolution. Pinned here: the signature is
 * recognized, a coarse bucket upgrades to a specific model, and a specific
 * model is never second-guessed.
 */
import { detectHardwareModel, inferIfUnknown } from './hardware-detect';

const POSTER_UA =
  'Mozilla/5.0 (Linux; Android 11; rk356x_box Build/RQ2A.210505.003; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.120 Safari/537.36 EduCMSPlayer/1.1.12';
const GOODVIEW_UA =
  'Mozilla/5.0 (Linux; Android 11; M55GUQ-CS1382D-C Build/RD2A.211001.002; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Safari/537.36';
const ECBOX_UA = 'Mozilla/5.0 (Linux; Android 11; rk3576 Build/X; wv) AppleWebKit/537.36 Chrome/95';

describe('detectHardwareModel — the LED poster signature', () => {
  it('a Rockchip rk356x_box WebView on Chromium 83 is a NovaStar Taurus poster', () => {
    expect(detectHardwareModel({ userAgent: POSTER_UA, osInfo: 'Android' })).toBe('novastar-taurus');
  });

  it('the Taurus / NovaStar markers still match', () => {
    expect(detectHardwareModel({ userAgent: 'Mozilla/5.0 (Linux; Android 8; Taurus TB6) Chrome/83' })).toBe('novastar-taurus');
  });

  it('the Goodview ECBox (rk3576) is not swept up by the rk356x rule', () => {
    expect(detectHardwareModel({ userAgent: ECBOX_UA })).toBe('goodview-ecbox3576');
  });

  it('a Goodview GUQ panel stays generic-android', () => {
    expect(detectHardwareModel({ userAgent: GOODVIEW_UA, osInfo: 'Android' })).toBe('generic-android');
  });
});

describe('inferIfUnknown — coarse buckets upgrade, specific models never move', () => {
  it('null → detected (the original back-fill)', () => {
    expect(inferIfUnknown({ userAgent: POSTER_UA }, null)).toBe('novastar-taurus');
  });

  it('generic-android → novastar-taurus when the signature is now recognized', () => {
    expect(inferIfUnknown({ userAgent: POSTER_UA }, 'generic-android')).toBe('novastar-taurus');
    expect(inferIfUnknown({ userAgent: POSTER_UA }, 'unknown')).toBe('novastar-taurus');
  });

  it('a coarse bucket never re-writes to the same or another coarse bucket', () => {
    expect(inferIfUnknown({ userAgent: GOODVIEW_UA, osInfo: 'Android' }, 'generic-android')).toBeNull();
    expect(inferIfUnknown({ userAgent: 'Mozilla/5.0 (nothing recognizable)' }, 'generic-android')).toBeNull();
    expect(inferIfUnknown({ userAgent: GOODVIEW_UA, osInfo: 'Android' }, 'unknown')).toBeNull();
  });

  it('a specific model is never second-guessed, whatever the UA says now', () => {
    expect(inferIfUnknown({ userAgent: POSTER_UA }, 'goodview-ep6n')).toBeNull();
    expect(inferIfUnknown({ userAgent: POSTER_UA }, 'novastar-taurus')).toBeNull();
    expect(inferIfUnknown({ userAgent: POSTER_UA }, 'maxhub-l55vec')).toBeNull();
  });

  it('nothing recognizable on a null column stays null', () => {
    expect(inferIfUnknown({ userAgent: 'curl/8.0' }, null)).toBeNull();
  });
});
