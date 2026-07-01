import { parseRssOrAtom, FeedParseError, MAX_FEED_ITEMS } from './rss-parser';

describe('parseRssOrAtom — RSS 2.0', () => {
  it('parses a well-formed RSS 2.0 feed with multiple items', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>District News</title>
          <item>
            <title>Board Meeting Tonight</title>
            <link>https://example.org/a</link>
            <pubDate>Mon, 01 Jul 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Spring Sports Registration</title>
            <link>https://example.org/b</link>
            <pubDate>Tue, 02 Jul 2026 08:30:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.title).toBe('District News');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      title: 'Board Meeting Tonight',
      link: 'https://example.org/a',
      publishedAt: new Date('Mon, 01 Jul 2026 12:00:00 GMT').toISOString(),
      source: 'District News',
    });
  });

  it('collapses a SINGLE <item> (fast-xml-parser returns an object, not a 1-element array)', () => {
    const xml = `<rss version="2.0"><channel><title>Solo</title>
      <item><title>Only One</title><link>https://example.org/only</link></item>
    </channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Only One');
  });

  it('handles zero items gracefully', () => {
    const xml = `<rss version="2.0"><channel><title>Empty Feed</title></channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.title).toBe('Empty Feed');
    expect(result.items).toEqual([]);
  });

  it('decodes HTML entities in titles', () => {
    const xml = `<rss version="2.0"><channel><title>News</title>
      <item><title>Rock &amp; Roll Night &lt;encore&gt;</title><link>https://example.org/x</link></item>
    </channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].title).toBe('Rock & Roll Night <encore>');
  });

  it('falls back to null publishedAt when pubDate is missing or unparseable', () => {
    const xml = `<rss version="2.0"><channel><title>News</title>
      <item><title>No Date</title><link>https://example.org/x</link></item>
      <item><title>Bad Date</title><link>https://example.org/y</link><pubDate>not-a-date</pubDate></item>
    </channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].publishedAt).toBeNull();
    expect(result.items[1].publishedAt).toBeNull();
  });

  it('caps items at MAX_FEED_ITEMS', () => {
    const items = Array.from({ length: MAX_FEED_ITEMS + 25 }, (_, i) =>
      `<item><title>Item ${i}</title><link>https://example.org/${i}</link></item>`,
    ).join('');
    const xml = `<rss version="2.0"><channel><title>Big Feed</title>${items}</channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items).toHaveLength(MAX_FEED_ITEMS);
  });

  it('clamps an absurdly long title', () => {
    const longTitle = 'A'.repeat(5000);
    const xml = `<rss version="2.0"><channel><title>News</title>
      <item><title>${longTitle}</title><link>https://example.org/x</link></item>
    </channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].title.length).toBeLessThanOrEqual(300);
  });

  it('parses RSS 1.0 / RDF feeds', () => {
    const xml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <channel><title>RDF Feed</title></channel>
        <item><title>RDF Item</title><link>https://example.org/rdf</link></item>
      </rdf:RDF>`;
    const result = parseRssOrAtom(xml);
    expect(result.title).toBe('RDF Feed');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('RDF Item');
  });
});

describe('parseRssOrAtom — Atom', () => {
  it('parses a well-formed Atom feed with multiple entries', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom News</title>
        <entry>
          <title>Entry One</title>
          <link href="https://example.org/1" rel="alternate"/>
          <updated>2026-07-01T12:00:00Z</updated>
        </entry>
        <entry>
          <title>Entry Two</title>
          <link href="https://example.org/2" rel="alternate"/>
          <published>2026-06-30T09:00:00Z</published>
        </entry>
      </feed>`;
    const result = parseRssOrAtom(xml);
    expect(result.title).toBe('Atom News');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      title: 'Entry One',
      link: 'https://example.org/1',
      publishedAt: '2026-07-01T12:00:00.000Z',
      source: 'Atom News',
    });
    expect(result.items[1].publishedAt).toBe('2026-06-30T09:00:00.000Z');
  });

  it('collapses a SINGLE <entry>', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Solo Atom</title>
      <entry><title>Only Entry</title><link href="https://example.org/x" rel="alternate"/></entry>
    </feed>`;
    const result = parseRssOrAtom(xml);
    expect(result.items).toHaveLength(1);
  });

  it('picks rel="alternate" when multiple <link> elements exist', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Multi-link</title>
      <entry>
        <title>Entry</title>
        <link href="https://example.org/self" rel="self"/>
        <link href="https://example.org/alt" rel="alternate"/>
      </entry>
    </feed>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].link).toBe('https://example.org/alt');
  });

  it('falls back to the first link when no rel="alternate" is present', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>No Alt</title>
      <entry><title>Entry</title><link href="https://example.org/only"/></entry>
    </feed>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].link).toBe('https://example.org/only');
  });
});

describe('parseRssOrAtom — malformed input', () => {
  it('throws FeedParseError on garbage/non-XML input', () => {
    expect(() => parseRssOrAtom('this is not xml at all {}')).toThrow(FeedParseError);
  });

  it('throws FeedParseError on empty string', () => {
    expect(() => parseRssOrAtom('')).toThrow(FeedParseError);
  });

  it('throws FeedParseError on a well-formed XML doc that is neither RSS nor Atom', () => {
    const xml = `<?xml version="1.0"?><html><body>Not a feed</body></html>`;
    expect(() => parseRssOrAtom(xml)).toThrow(FeedParseError);
  });

  it('tolerates truncated/unclosed XML the way fast-xml-parser does (lenient, not a throw)', () => {
    // fast-xml-parser is deliberately lenient with malformed XML (real RSS
    // feeds in the wild are often slightly broken) — it recovers a partial
    // document rather than throwing. We document that behavior here rather
    // than pretend it's an all-or-nothing "invalid XML" throw. As long as
    // <rss><channel> is recognizable, we return a best-effort (possibly
    // empty-title) result instead of erroring the whole request.
    const xml = `<rss version="2.0"><channel><title>Broken`;
    const result = parseRssOrAtom(xml);
    expect(result.items).toEqual([]);
  });

  it('throws FeedParseError when truncation destroys even the outer shape', () => {
    const xml = `<rs`; // not recognizable as anything
    expect(() => parseRssOrAtom(xml)).toThrow(FeedParseError);
  });

  it('handles an item missing a title without crashing', () => {
    const xml = `<rss version="2.0"><channel><title>News</title>
      <item><link>https://example.org/x</link></item>
    </channel></rss>`;
    const result = parseRssOrAtom(xml);
    expect(result.items[0].title).toBe('(untitled)');
  });
});
