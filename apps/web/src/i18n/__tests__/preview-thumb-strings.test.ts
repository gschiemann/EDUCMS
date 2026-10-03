import en from '../messages/en.json';
import es from '../messages/es.json';
import zh from '../messages/zh.json';

/**
 * The accessible names of the three preview thumbnails (a website screenshot,
 * a scheduled image sequence, a saved template) are spoken to screen-reader
 * users, so they ship in every language — a missing key falls back to the key
 * PATH, which is what would be read aloud.
 */
const KEYS: Array<[ns: 'assetsLib' | 'playlistsPage', key: string, placeholders: string[]]> = [
  ['assetsLib', 'websitePreview', []],
  ['assetsLib', 'websitePreviewOf', ['name']],
  ['assetsLib', 'websitePreviewUnavailable', []],
  ['assetsLib', 'websitePreviewUnavailableOf', ['name']],
  ['playlistsPage', 'imageSequence', []],
  ['playlistsPage', 'imageSequenceOf', ['name']],
  ['playlistsPage', 'templatePreview', []],
  ['playlistsPage', 'templatePreviewOf', ['name']],
];

const catalogs = { en, es, zh } as unknown as Record<string, Record<string, Record<string, string>>>;

describe.each(Object.keys(catalogs))('%s catalog', (lang) => {
  it.each(KEYS)('%s.%s is present and keeps its placeholders', (ns, key, placeholders) => {
    const value = catalogs[lang][ns][key];
    expect(typeof value).toBe('string');
    expect(value.trim().length).toBeGreaterThan(0);
    for (const name of placeholders) expect(value).toContain(`{${name}}`);
    // A key that takes no name must not carry a stray placeholder.
    if (placeholders.length === 0) expect(value).not.toMatch(/\{\w+\}/);
  });
});

it('the Spanish and Chinese strings are really translated, not copies of the English', () => {
  for (const [ns, key] of KEYS) {
    expect(catalogs.es[ns][key]).not.toBe(catalogs.en[ns][key]);
    expect(catalogs.zh[ns][key]).not.toBe(catalogs.en[ns][key]);
  }
});
