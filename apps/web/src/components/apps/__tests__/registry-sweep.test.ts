/**
 * Registry sweep (2026-10-12, "get the apps to be fully functional").
 *
 * Every app in APP_REGISTRY, with a realistic paste, must build a zone whose
 * widget the renderer knows — and a NEW app cannot join the registry without
 * a row here. The browser half of this sweep is
 * tests/e2e/builder-apps-functional.spec.ts.
 */
import { APP_REGISTRY } from '../app-registry';
import { buildApp } from '../build-app';
import { appDefaultValues } from '../app-zone';

const SAMPLE: Record<string, { values: Record<string, string>; widget: string }> = {
  youtube: { values: { url: 'https://youtu.be/dQw4w9WgXcQ' }, widget: 'STREAMING' },
  vimeo: { values: { url: 'https://vimeo.com/76979871/8272103f6e' }, widget: 'STREAMING' },
  twitch: { values: { channel: 'venueos' }, widget: 'STREAMING' },
  'google-slides': { values: { url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQr/edit' }, widget: 'WEBPAGE' },
  'powerpoint-onedrive': { values: { url: 'https://onedrive.live.com/embed?resid=ABC123&authkey=XYZ' }, widget: 'WEBPAGE' },
  canva: { values: { url: 'https://www.canva.com/design/DAF123abc/view' }, widget: 'WEBPAGE' },
  'google-sheets': { values: { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit' }, widget: 'WEBPAGE' },
  'web-url': { values: { url: 'example.com' }, widget: 'WEBPAGE' },
  'google-maps': { values: { query: '1 Main St, Springfield, IL' }, widget: 'WEBPAGE' },
  'qr-code': { values: { text: 'https://example.com/menu' }, widget: 'TOUCH_POINT' },
  clock: { values: {}, widget: 'CLOCK' },
  countdown: { values: { targetDate: '2026-12-25' }, widget: 'COUNTDOWN' },
  weather: { values: { location: 'Chicago, IL' }, widget: 'WEATHER' },
  'news-rss': { values: { feedUrl: 'https://example.com/feed.xml' }, widget: 'RSS_FEED' },
  calendar: { values: { url: 'https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com' }, widget: 'WEBPAGE' },
  'facebook-page': { values: { connectionId: 'conn_12345678' }, widget: 'SOCIAL_FEED' },
  instagram: { values: { connectionId: 'conn_12345678' }, widget: 'SOCIAL_FEED' },
  'social-wall': { values: { url: 'https://my.walls.io/venueos' }, widget: 'WEBPAGE' },
  'google-reviews': { values: { placeId: 'ChIJfixturePlaceId0001', placeName: 'E2E Diner' }, widget: 'GOOGLE_REVIEWS' },
};

describe('every app in the registry sets up', () => {
  it('has a sample for every app (a new app needs one)', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(APP_REGISTRY.map((a) => a.id).sort());
  });

  it.each(APP_REGISTRY.map((a) => [a.id, a] as const))('%s builds its widget from a real paste', (id, app) => {
    const s = SAMPLE[id];
    const out = buildApp(app, appDefaultValues(app, s.values));
    if (!out.ok) throw new Error(`${id}: ${out.reason}`);
    expect(out.widgetType).toBe(s.widget);
  });

  it.each(APP_REGISTRY.filter((a) => a.configSchema.some((f) => f.required)).map((a) => [a.id, a] as const))(
    '%s refuses an empty form (no blank zone ever)',
    (_id, app) => {
      expect(buildApp(app, appDefaultValues(app)).ok).toBe(false);
    },
  );
});
