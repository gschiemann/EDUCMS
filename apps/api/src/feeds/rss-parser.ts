/**
 * Pure RSS 2.0 + Atom parser. No network, no NestJS deps — takes raw XML
 * text, returns a normalized `RssFeedResult`. Kept side-effect-free so it's
 * trivially unit-testable against fixtures (including malformed XML).
 *
 * Uses `fast-xml-parser` (already a direct dependency of apps/api — see
 * package.json — used elsewhere for PPTX parsing) rather than adding a new
 * RSS-specific library. RSS 2.0 and Atom are both just XML; the two formats
 * differ only in tag names or the wrapper's structure, which we branch on.
 */

import { XMLParser } from 'fast-xml-parser';
import { FeedItem, RssFeedResult } from './feeds.types';

export const MAX_FEED_ITEMS = 50;
const MAX_TITLE_LEN = 300;
const MAX_LINK_LEN = 2000;

export class FeedParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'FeedParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // RSS/Atom feeds routinely have CDATA titles/descriptions with HTML —
  // trimming here keeps every downstream string tidy without a second pass.
  trimValues: true,
  // Some feeds emit malformed entity refs (bare `&` in a URL query string).
  // Don't let the whole parse blow up over one bad entity — fast-xml-parser
  // has no direct flag for this, but wrapping parse() in try/catch (below)
  // is the safety net; this option just keeps well-formed docs fast.
  processEntities: true,
});

/** Always returns a string, coercing numbers/booleans fast-xml-parser may
 *  have inferred (a title like "2026" would otherwise arrive as a number). */
function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    // CDATA / mixed-content nodes sometimes parse to { '#text': '...' }.
    const t = (v as any)['#text'];
    if (t != null) return str(t);
    return '';
  }
  return String(v);
}

function clamp(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Normalize any date-ish string to ISO-8601, or null if unparseable.
 *  RSS uses RFC-822 (`Mon, 01 Jul 2026 12:00:00 GMT`); Atom uses ISO-8601
 *  already. `Date.parse` accepts both natively in V8/Node. */
function toIso(raw: unknown): string | null {
  const s = str(raw);
    if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Always returns an array, since fast-xml-parser collapses a
 *  single-child element to a bare object instead of a 1-element array. */
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Atom `<link>` can be a single object, an array of objects (rel=alternate
 *  vs rel=self etc.), or (non-conformant but seen in the wild) a bare
 *  string. Prefer rel="alternate" or the first href-bearing entry. */
function atomLinkHref(link: unknown): string {
  const links = toArray(link as any);
  if (!links.length) return '';
  const withHref = links.find((l) => l && typeof l === 'object' && (l as any)['@_href']);
  if (withHref) {
    const alternate = links.find(
      (l) => l && typeof l === 'object' && (l as any)['@_rel'] === 'alternate' && (l as any)['@_href'],
    );
    return str((alternate ?? withHref) && ((alternate ?? withHref) as any)['@_href']);
  }
  // Bare string fallback (non-conformant feeds).
  return str(links[0]);
}

export function parseRssOrAtom(xml: string): RssFeedResult {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (e: any) {
    throw new FeedParseError(`Could not parse feed XML: ${e?.message || e}`);
  }
  if (!doc || typeof doc !== 'object') {
    throw new FeedParseError('Feed document was empty');
  }

  // ── RSS 2.0 / RSS 1.0 (rdf) ──
  if (doc.rss?.channel) {
    const channel = doc.rss.channel;
    const feedTitle = clamp(str(channel.title) || 'RSS Feed', MAX_TITLE_LEN);
    const rawItems = toArray(channel.item);
    const items: FeedItem[] = rawItems.slice(0, MAX_FEED_ITEMS).map((it: any) => ({
      title: clamp(str(it.title) || '(untitled)', MAX_TITLE_LEN),
      link: clamp(str(it.link), MAX_LINK_LEN),
      publishedAt: toIso(it.pubDate ?? it['dc:date']),
      source: feedTitle,
    }));
    return { title: feedTitle, items };
  }

  // RDF/RSS 1.0: <rdf:RDF><channel>...</channel><item>...</item>...</rdf:RDF>
  // (items are siblings of <channel>, not children — different shape.)
  const rdfRoot = doc['rdf:RDF'];
  if (rdfRoot?.channel) {
    const feedTitle = clamp(str(rdfRoot.channel.title) || 'RSS Feed', MAX_TITLE_LEN);
    const rawItems = toArray(rdfRoot.item);
    const items: FeedItem[] = rawItems.slice(0, MAX_FEED_ITEMS).map((it: any) => ({
      title: clamp(str(it.title) || '(untitled)', MAX_TITLE_LEN),
      link: clamp(str(it.link), MAX_LINK_LEN),
      publishedAt: toIso(it['dc:date']),
      source: feedTitle,
    }));
    return { title: feedTitle, items };
  }

  // ── Atom ──
  if (doc.feed) {
    const feed = doc.feed;
    const feedTitle = clamp(str(feed.title) || 'Atom Feed', MAX_TITLE_LEN);
    const rawEntries = toArray(feed.entry);
    const items: FeedItem[] = rawEntries.slice(0, MAX_FEED_ITEMS).map((entry: any) => ({
      title: clamp(str(entry.title) || '(untitled)', MAX_TITLE_LEN),
      link: clamp(atomLinkHref(entry.link), MAX_LINK_LEN),
      publishedAt: toIso(entry.updated ?? entry.published),
      source: feedTitle,
    }));
    return { title: feedTitle, items };
  }

  throw new FeedParseError('Document was not a recognizable RSS or Atom feed');
}
