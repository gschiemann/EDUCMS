/** Banner options on a pushed broadcast (2026-11-01). */
import { pushedEmergencyFromPayload } from '../pushedEmergencyMessage';
import { emergencyMessageFromPollRow } from '../pushedMessages';

describe('banner options on a pushed broadcast', () => {
  const base = { messageId: 'b1', severity: 'INFO', text: 'Hello', expiresAt: 1_792_752_550 };
  it('carries sanitised options for an INFO / WARN text broadcast', () => {
    const m = pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, banner: { color: '#ABC', mode: 'scroll', speed: 'slow' } }, 'e');
    expect(m.banner).toEqual({ color: '#aabbcc', mode: 'scroll', speed: 'slow' });
  });
  it('omits the key when absent or hostile (paint identity of old messages unchanged)', () => {
    expect('banner' in pushedEmergencyFromPayload('TEXT_BROADCAST', base, 'e')).toBe(false);
    expect('banner' in pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, banner: { color: 'url(x)' } }, 'e')).toBe(false);
  });
  it('is ignored for CRITICAL text, SOS and media alerts', () => {
    const banner = { color: '#15803d', mode: 'scroll' };
    expect('banner' in pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, severity: 'CRITICAL', banner }, 'e')).toBe(false);
    expect('banner' in pushedEmergencyFromPayload('SOS', { ...base, banner }, 'e')).toBe(false);
    expect('banner' in pushedEmergencyFromPayload('MEDIA_ALERT', { ...base, banner }, 'e')).toBe(false);
  });
});

describe('banner text size (2026-11-23)', () => {
  const base = { messageId: 'b1', severity: 'WARN', text: 'Hello', expiresAt: 1_792_752_550 };
  const row = (banner: unknown) => ({ id: 'b1', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'Hello', mediaUrls: [], audioUrl: null, expiresAt: 1_792_752_550, createdAt: '2026-11-23T15:00:00.000Z', banner });

  it('the push and the poll carry the same size', () => {
    const banner = { mode: 'scroll', speed: 'slow', size: 'large' };
    expect(pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, banner }, 'e').banner).toEqual(banner);
    expect(emergencyMessageFromPollRow(row(banner)).banner).toEqual(banner);
  });

  it('an older message (no size) is medium: no size key, exactly as before', () => {
    const banner = { mode: 'scroll', speed: 'slow' };
    expect(pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, banner }, 'e').banner).toEqual(banner);
    expect(emergencyMessageFromPollRow(row(banner)).banner).toEqual(banner);
  });

  it('an unknown size is medium; a medium size is dropped so both forms hash alike', () => {
    expect(pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, banner: { mode: 'static', size: 'jumbo' } }, 'e').banner).toEqual({ mode: 'static', speed: 'normal' });
    expect(JSON.stringify(emergencyMessageFromPollRow(row({ mode: 'static', size: 'medium' })).banner)).toBe('{"mode":"static","speed":"normal"}');
  });

  it('CRITICAL text never carries a size', () => {
    expect('banner' in pushedEmergencyFromPayload('TEXT_BROADCAST', { ...base, severity: 'CRITICAL', banner: { mode: 'static', size: 'large' } }, 'e')).toBe(false);
  });
});
