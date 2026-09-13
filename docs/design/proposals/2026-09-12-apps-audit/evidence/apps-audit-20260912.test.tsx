/** Audit evidence, not acceptance tests. 'Reproduces' tests deliberately assert
 * the current defect so the captured run documents it without fixing product code.
 * Provider networks and the canvas store are mocked; no playback certification. */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { APP_REGISTRY, getApp, listApps } from '../app-registry';
import * as urls from '../url-transforms';
import { normalizeEmbedUrl } from '../../widgets/StreamingWidget';
import { AppConfigForm } from '../AppConfigForm';

const mockAdd = jest.fn(() => 'audit-zone');
const mockUpdate = jest.fn();
const mockSelect = jest.fn();
const mockGenerate = jest.fn(async () => ({ candidates: [{ html: '<div>Generated sample</div>' }] }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => <div data-testid="mock-preview" /> }));
jest.mock('@/components/template-builder/useBuilderStore', () => ({
  useBuilderStore: (select: any) => select({ addZone: mockAdd, updateZone: mockUpdate, select: mockSelect, meta: { screenWidth: 1920, screenHeight: 1080 } }),
}));
jest.mock('@/hooks/use-api', () => ({ useTenant: () => ({ data: {} }), useGenerateDesignerCandidates: () => ({ mutateAsync: mockGenerate, isPending: false }) }));
jest.mock('@/hooks/use-tenant-copy', () => ({ useTenantCopy: () => ({ vertical: 'education' }) }));
jest.mock('@/components/ai/AiGenerateButton', () => ({ getAiStatusSource: async () => 'available' }));
const opts = { muted: true, autoplay: true };
afterEach(() => { cleanup(); jest.clearAllMocks(); });

describe('registry inventory and valid source-to-renderer paths', () => {
  it.each(APP_REGISTRY.filter(a => !a.comingSoon).map(a => [a.id]))('%s: valid form input reaches a canvas mutation', async (id) => {
    const app = getApp(id)!;
    const initialValues = { url: 'https://example.com/content', channel: 'schoolchannel', query: 'Main School', text: 'https://school.example', timezone: 'America/Chicago', targetDate: '2027-06-01', location: '62704', feedUrl: 'https://school.example/feed.xml' };
    render(<AppConfigForm app={app} onBack={() => {}} onDone={() => {}} initialValues={initialValues} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to canvas' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
  it('has 19 entries: 15 configured and 4 coming soon', () => {
    expect(APP_REGISTRY).toHaveLength(19);
    expect(APP_REGISTRY.filter(a => !a.comingSoon)).toHaveLength(15);
    expect(APP_REGISTRY.filter(a => a.comingSoon).map(a => a.id)).toEqual(['facebook-page', 'instagram', 'social-wall', 'google-reviews']);
  });
  it('normalizes an ordinary YouTube video through both layers', () => {
    const c = getApp('youtube')!.build({ url: 'https://youtu.be/abc123XYZ12', muted: 'true' });
    expect(c.widgetType).toBe('STREAMING');
    expect(normalizeEmbedUrl(String(c.defaultConfig.embedUrl), opts)).toContain('/embed/abc123XYZ12?');
  });
  it('normalizes a public Vimeo ID and Twitch channel', () => {
    expect(normalizeEmbedUrl(urls.toVimeoCanonicalUrl('https://vimeo.com/123456789'), opts)).toContain('player.vimeo.com/video/123456789');
    expect(normalizeEmbedUrl(urls.toTwitchCanonicalUrl('schoolchannel'), opts)).toContain('channel=schoolchannel&parent=localhost');
  });
  it('preserves a published Sheets embed and extracts an Office iframe src', () => {
    const sheet = 'https://docs.google.com/spreadsheets/d/e/PUB/pubhtml?gid=7&single=true';
    expect(urls.toGoogleSheetsEmbedUrl(sheet)).toBe(sheet);
    expect(urls.extractIframeSrc('<iframe src="https://onedrive.live.com/embed?resid=123"></iframe>')).toBe('https://onedrive.live.com/embed?resid=123');
  });
  it('has real utility configurations, including QR payload and metric weather', () => {
    expect(getApp('qr-code')!.build({ text: 'https://school.example/open-house' }).defaultConfig.qrText).toBe('https://school.example/open-house');
    expect(getApp('weather')!.build({ location: '62704', units: 'metric' }).defaultConfig.units).toBe('metric');
    expect(getApp('news-rss')!.build({ feedUrl: 'https://school.example/feed.xml', maxItems: '5' }).widgetType).toBe('RSS_FEED');
  });
});

describe('reproduced defects — assertions document current broken behavior', () => {
  it('reproduces includeComingSoon:false returning coming-soon entries', () => {
    expect(listApps({ includeComingSoon: false }).filter(a => a.comingSoon)).toHaveLength(4);
  });
  it('reproduces YouTube playlist being routed to generic Web Page', () => {
    const u = 'https://www.youtube.com/playlist?list=PL123456789';
    expect(urls.detectApp(u)?.appId).toBe('web-url');
    expect(normalizeEmbedUrl(urls.toYoutubeCanonicalUrl(u), opts)).toBe(u);
  });
  it('reproduces watch query-order losing proper video embedding', () => {
    const u = 'https://www.youtube.com/watch?feature=shared&v=abc123XYZ12';
    expect(urls.youtubeVideoId(u)).toBeNull();
    expect(normalizeEmbedUrl(u, opts)).toBe(u);
  });
  it('reproduces /channel/ID/live not becoming a player URL', () => {
    const u = 'https://www.youtube.com/channel/UC123456789/live';
    expect(normalizeEmbedUrl(u, opts)).toBe(u);
  });
  it('reproduces dropping Vimeo unlisted hash in BOTH layers', () => {
    expect(urls.toVimeoCanonicalUrl('https://vimeo.com/123456789/abcdef1234')).toBe('https://vimeo.com/123456789');
    expect(normalizeEmbedUrl('https://player.vimeo.com/video/123456789?h=abcdef1234', opts)).not.toContain('h=abcdef1234');
  });
  it('reproduces Sheets edit-link normalization losing selected tab', () => {
    expect(urls.toGoogleSheetsEmbedUrl('https://docs.google.com/spreadsheets/d/DECK/edit#gid=987')).not.toContain('987');
  });
  it('reproduces Canva embed parameter going into the fragment', () => {
    const result = new URL(urls.toCanvaEmbedUrl('https://www.canva.com/design/DECK/view#page=2'));
    expect(result.searchParams.has('embed')).toBe(false);
    expect(result.hash).toContain('?embed');
  });
  it('reproduces Calendar embed snippets not being extracted', () => {
    const u = '<iframe src="https://calendar.google.com/calendar/embed?src=demo%40example.com"></iframe>';
    expect(urls.toGoogleCalendarEmbedUrl(u)).toBe(u);
    expect(urls.detectApp('https://calendar.google.com/calendar/embed?src=demo%40example.com')?.appId).toBe('web-url');
  });
  it('reproduces secret ICS conversion losing the private token', () => {
    const result = urls.toGoogleCalendarEmbedUrl('https://calendar.google.com/calendar/ical/demo%40example.com/private-FAKE_TOKEN/basic.ics');
    expect(result).not.toContain('FAKE_TOKEN');
    expect(result).toContain('ctz=local');
  });
  it('reproduces malformed calendar percent-encoding throwing', () => {
    expect(() => urls.toGoogleCalendarEmbedUrl('https://calendar.google.com/calendar/ical/%ZZ/public/basic.ics')).toThrow();
  });
  it('reproduces Maps short links routed to Web Page and long links treated as address text', () => {
    expect(urls.detectApp('https://maps.app.goo.gl/EXAMPLE')?.appId).toBe('web-url');
    const u = 'https://www.google.com/maps/place/School';
    expect(new URL(urls.toGoogleMapsEmbedUrl(u)).searchParams.get('q')).toBe(u);
  });
  it('reproduces foreign-host path being identified as Google Slides', () => {
    expect(urls.detectApp('https://untrusted.example/docs.google.com/presentation/d/DECK/edit')?.appId).toBe('google-slides');
  });
  it('records five provider apps forced through static mode', () => {
    for (const id of ['google-slides', 'powerpoint-onedrive', 'google-sheets', 'google-maps', 'calendar']) {
      expect(getApp(id)!.build({ url: 'https://example.com', query: 'School' }).defaultConfig.staticMode).toBe(true);
    }
  });
  it('reproduces invalid nonempty link adding a broken canvas zone', async () => {
    render(<AppConfigForm app={getApp('web-url')!} onBack={() => {}} onDone={() => {}} initialValues={{ url: 'not a valid url' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to canvas' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(mockUpdate).toHaveBeenCalledWith('audit-zone', { defaultConfig: expect.objectContaining({ url: 'https://not a valid url' }) });
  });
  it('reproduces a caught build error still adding an empty WEBPAGE', async () => {
    render(<AppConfigForm app={getApp('calendar')!} onBack={() => {}} onDone={() => {}} initialValues={{ url: 'https://calendar.google.com/calendar/ical/%ZZ/public/basic.ics' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to canvas' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add to canvas' }));
    expect(mockUpdate).toHaveBeenCalledWith('audit-zone', { defaultConfig: {} });
  });
  it('reproduces AI request and resulting zone omitting configured source', async () => {
    const source = 'https://youtu.be/abc123XYZ12';
    render(<AppConfigForm app={getApp('youtube')!} onBack={() => {}} onDone={() => {}} initialValues={{ url: source }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Design one with AI' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(JSON.stringify(mockGenerate.mock.calls)).not.toContain(source);
    expect(mockAdd).toHaveBeenCalledWith('EXTERNAL_HTML', undefined, { w: 100, h: 100 });
    expect(JSON.stringify(mockUpdate.mock.calls)).not.toContain('abc123XYZ12');
  });
  it('blocks adding a coming-soon app (existing safeguard works)', async () => {
    render(<AppConfigForm app={getApp('instagram')!} onBack={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to canvas' })).toBeDisabled());
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
