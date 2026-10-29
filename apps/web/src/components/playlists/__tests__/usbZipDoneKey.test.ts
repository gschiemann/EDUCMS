import { zipDoneKey } from '../UsbExport';

// Real user agents: which "downloaded" message each browser gets.
const UA = {
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

describe('zipDoneKey', () => {
  it('gives desktop Safari the "ask for each download" tip', () => {
    expect(zipDoneKey(UA.safariMac)).toBe('doneZipSafari');
  });
  it('gives Firefox (any OS) its "always ask where to save" tip', () => {
    expect(zipDoneKey(UA.firefoxWin)).toBe('doneZipFirefox');
  });
  it('keeps the plain message for Chromium browsers and phones', () => {
    expect(zipDoneKey(UA.chromeMac)).toBe('doneZip');
    expect(zipDoneKey(UA.edgeWin)).toBe('doneZip');
    expect(zipDoneKey(UA.safariIphone)).toBe('doneZip');
    expect(zipDoneKey(UA.chromeAndroid)).toBe('doneZip');
    expect(zipDoneKey('')).toBe('doneZip');
  });
});
