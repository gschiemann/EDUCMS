import { safeEmergencyMediaUrl } from '../EmergencyOverlay';

describe('safeEmergencyMediaUrl', () => {
  it('keeps https media, as the API requires', () => {
    expect(safeEmergencyMediaUrl('https://x.supabase.co/storage/v1/object/public/a/lockdown.mp4'))
      .toBe('https://x.supabase.co/storage/v1/object/public/a/lockdown.mp4');
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/a.png',
    'not a url',
    '',
    null,
    42,
  ])('refuses %p', (raw) => {
    expect(safeEmergencyMediaUrl(raw)).toBeNull();
  });
});
