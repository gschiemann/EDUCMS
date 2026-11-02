/** Banner options on a pushed broadcast (2026-11-01). */
import { pushedEmergencyFromPayload } from '../pushedEmergencyMessage';

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
