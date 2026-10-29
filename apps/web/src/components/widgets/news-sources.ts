/** Included sources allow attributed editorial reuse. No logos, article bodies or photos. */
export const NEWS_SOURCES = [
  { id: 'global-voices', name: 'Global Voices · World', url: 'https://globalvoices.org/feed/', license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', needsAuthor: true },
  { id: 'nasa', name: 'NASA · Science & space', url: 'https://www.nasa.gov/news-release/feed/', license: '', licenseUrl: '', needsAuthor: false },
] as const;
export const DEFAULT_NEWS_SOURCES = ['global-voices', 'nasa'];
export function newsSourceIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && NEWS_SOURCES.some(s => s.id === id)))] : DEFAULT_NEWS_SOURCES;
}
