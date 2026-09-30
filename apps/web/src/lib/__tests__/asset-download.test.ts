import { assetDownloadUrl } from '../asset-download';

const api = 'https://api.example.com';
const object = 'https://project.supabase.co/storage/v1/object/public/assets/tenant/movie.mp4';

describe('asset downloads', () => {
  it('requests an attachment with the uploaded name, keeping existing URL parameters', () => {
    const result = assetDownloadUrl({ fileUrl: `${object}?cache=1`, originalName: 'Café & welcome.mp4' }, api);
    const url = new URL(result.url);
    expect(url.searchParams.get('download')).toBe('Café & welcome.mp4');
    expect(url.searchParams.get('cache')).toBe('1');
    expect(url.pathname).toBe(new URL(object).pathname);
  });

  it('preserves signed storage tokens', () => {
    const result = assetDownloadUrl({ fileUrl: object.replace('/public/', '/sign/') + '?token=signature' }, api);
    expect(new URL(result.url).searchParams.get('token')).toBe('signature');
    expect(result.filename).toBe('movie.mp4');
  });

  it('uses the same attachment behavior for legacy local uploads', () => {
    const result = assetDownloadUrl({ fileUrl: '/api/v1/assets/file/abc.pdf', originalName: 'Plan.pdf' }, api);
    expect(result.url).toBe(`${api}/api/v1/assets/file/abc.pdf?download=Plan.pdf`);
  });

  it('removes control characters and path separators from download names', () => {
    const result = assetDownloadUrl({ fileUrl: object, originalName: 'folder\\welcome/film\r\n.mp4' }, api);
    expect(result.filename).toBe('folder_welcome_film__.mp4');
  });

  it.each([
    'javascript:alert(1)',
    'https://project.supabase.co.evil.example/storage/v1/object/public/assets/x.mp4',
    'https://other.example/api/v1/assets/file/x.mp4',
    'https://example.com/movie.mp4',
  ])('refuses unsupported destinations instead of navigating to a preview: %s', (fileUrl) => {
    expect(() => assetDownloadUrl({ fileUrl }, api)).toThrow();
  });

  it('explains that a web link is not a stored file', () => {
    expect(() => assetDownloadUrl({ fileUrl: 'https://example.com/', mimeType: 'text/html' }, api))
      .toThrow('Web links do not have a downloadable file');
  });
});
