import { templatePosterUrl, POSTER_VERSION } from '../template-poster';

const board = (url: string, extra: Record<string, unknown> = {}) => [
  { widgetType: 'EXTERNAL_HTML', defaultConfig: { url, ...extra } },
];

describe('templatePosterUrl', () => {
  it('maps a board html path to its poster PNG', () => {
    expect(templatePosterUrl(board('/templates/signage/gym/leaderboard.html')))
      .toBe(`/templates/_thumbs/signage/gym/leaderboard.png?v=${POSTER_VERSION}`);
  });

  // The real preset behind the operator's blank row.
  it('resolves the portrait composition to the portrait poster, not the landscape one', () => {
    expect(templatePosterUrl(board('/templates/signage/gym/leaderboard-v3-plate-stack-portrait.html?orientation=portrait')))
      .toBe(`/templates/_thumbs/signage/gym/leaderboard-v3-plate-stack-portrait-portrait.png?v=${POSTER_VERSION}`);
  });

  it('resolves the short orientation parameter used by school and new workflow presets', () => {
    expect(templatePosterUrl(board('/templates/school/commencement-guest-guide.html?o=portrait')))
      .toBe(`/templates/_thumbs/school/commencement-guest-guide-portrait.png?v=${POSTER_VERSION}`);
    expect(templatePosterUrl(board('/templates/school/campus-pulse/01-campus-magazine.html?brand=example&o=portrait')))
      .toBe(`/templates/_thumbs/school/campus-pulse/01-campus-magazine-portrait.png?v=${POSTER_VERSION}`);
    expect(templatePosterUrl(board('/templates/school/campus-pulse/01-campus-magazine.html?o=landscape')))
      .toBe(`/templates/_thumbs/school/campus-pulse/01-campus-magazine.png?v=${POSTER_VERSION}`);
  });

  it('parses a config that arrived as a JSON string', () => {
    const zones = [{ widgetType: 'EXTERNAL_HTML', defaultConfig: JSON.stringify({ url: '/templates/hs/a.html' }) }];
    expect(templatePosterUrl(zones)).toBe(`/templates/_thumbs/hs/a.png?v=${POSTER_VERSION}`);
  });

  it('declines anything that is not a single external board', () => {
    expect(templatePosterUrl([])).toBeNull();
    expect(templatePosterUrl(null)).toBeNull();
    expect(templatePosterUrl([{ widgetType: 'CLOCK' }])).toBeNull();
    expect(templatePosterUrl([...board('/templates/a.html'), { widgetType: 'CLOCK' }])).toBeNull();
    // Not one of ours / not a board file.
    expect(templatePosterUrl(board('https://evil.example/x.html'))).toBeNull();
    expect(templatePosterUrl(board('/templates/a.json'))).toBeNull();
  });

  describe('a customized board', () => {
    const customized = board('/templates/hs/a.html', { brand: { primary: '#f00' } });

    it('is declined by default, so the gallery renders it live and shows the customization', () => {
      expect(templatePosterUrl(customized)).toBeNull();
    });

    it('renders media fit/rotation and video replacements live instead of hiding them behind the default poster', () => {
      expect(templatePosterUrl(board('/templates/hs/a.html', { mediaStyles: { hero: { rotation: 90, fit: 'contain' } } }))).toBeNull();
      expect(templatePosterUrl(board('/templates/hs/a.html', { videoOverrides: { hero: '/clip.mp4' } }))).toBeNull();
    });

    it('is allowed when the caller opts in — a table row cannot mount a live 4K frame', () => {
      expect(templatePosterUrl(customized, { allowCustomized: true }))
        .toBe(`/templates/_thumbs/hs/a.png?v=${POSTER_VERSION}`);
    });
  });
});
