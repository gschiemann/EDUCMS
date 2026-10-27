'use client';
import { useEffect, useState } from 'react';
import { useElementSize } from './v2/_shared/useElementSize';
import { Rss } from 'lucide-react';
import { useLiveRssFeed } from './use-live-feed';
import { NEWS_SOURCES, newsSourceIds } from './news-sources';
import type { FeedItem } from './feed-types';

const clean = (value: string) => value.replace(/<[^>]*>/g, '').trim();
export function mixHeadlines(feeds: { items: FeedItem[] | null; sourceId: string }[], now = Date.now()) {
  const seen = new Set<string>(); const groups = feeds.map(feed => (feed.items || []).filter(item => {
    const source = NEWS_SOURCES.find(s => s.id === feed.sourceId);
    const date = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    return /^https?:\/\//i.test(item.link) && !!clean(item.title) && Number.isFinite(date) && date >= now - 7 * 86400000 && date <= now + 3600000 && (!source?.needsAuthor || !!item.author?.trim());
  }).slice(0, 12).map(item => ({ ...item, sourceId: feed.sourceId })));
  const result: (FeedItem & { sourceId: string })[] = [];
  for (let i = 0; i < 12; i++) for (const group of groups) { const item = group[i]; if (item && !seen.has(item.link)) { seen.add(item.link); result.push(item); } }
  return result;
}
export function HeadlinesWidget({ config = {} }: { config?: Record<string, any> }) {
  const selected = newsSourceIds(config.sources);
  const custom = String(config.feedUrl || config.url || '').trim();
  // Fixed hook order; unchecked sources do not fetch. The existing backend handles
  // SSRF protection, feed parsing, cross-screen caching and five-minute refresh.
  const world = useLiveRssFeed(selected.includes('global-voices') ? NEWS_SOURCES[0].url : undefined, 12, 60 * 60 * 1000);
  const nasa = useLiveRssFeed(selected.includes('nasa') ? NEWS_SOURCES[1].url : undefined, 12, 60 * 60 * 1000);
  const extra = useLiveRssFeed(custom || undefined, 12, 60 * 60 * 1000);
  const items = mixHeadlines([{ items: world.items, sourceId: 'global-voices' }, { items: nasa.items, sourceId: 'nasa' }, { items: extra.items, sourceId: 'custom' }]);
  const [index, setIndex] = useState(0);
  const { ref: root, width, height } = useElementSize<HTMLDivElement>();
  const size = { w: width || 1000, h: height || 400 };
  const seconds = Math.max(5, Math.min(120, Number(config.intervalSec) || 12));
  const identity = items.map(i => i.link).join('|');
  useEffect(() => { setIndex(0); const timer = setInterval(() => { if (!document.hidden) setIndex(i => (i + 1) % Math.max(1, items.length)); }, seconds * 1000); return () => clearInterval(timer); }, [identity, seconds, items.length]);

  const item = items[index % Math.max(1, items.length)];
  const source = NEWS_SOURCES.find(s => s.id === item?.sourceId);
  const anyError = (selected.includes('global-voices') && world.error) || (selected.includes('nasa') && nasa.error) || (!!custom && extra.error);
  const loading = world.loading || nasa.loading || (!!custom && extra.loading);
  const font = Math.max(10, Math.min(224, size.w / 15, size.h / 11));
  return <div ref={root} data-headlines-widget style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: '1.2em', background: config.style?.bgColor || config.bgColor || '#f5f2ea', color: config.style?.textColor || config.textColor || '#162d37', fontFamily: config.style?.fontFamily || 'Inter, sans-serif', fontSize: font, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <header style={{ display: 'flex', alignItems: 'center', fontSize: '.6em', letterSpacing: '.14em', textTransform: 'uppercase', borderBottom: '1px solid #84929a55', paddingBottom: '.8em', flexShrink: 0 }}><Rss aria-hidden style={{ width: '1em', height: '1em', marginRight: '.6em' }} /><span>{config.title ?? 'Headlines'}</span><span style={{ marginLeft: 'auto', letterSpacing: 0, opacity: .6 }}>{item ? `${index % items.length + 1} / ${items.length}` : ''}</span></header>
    {item ? <article key={item.link} data-headline-story style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '.7em 0' }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '.1em', fontSize: '.5em', opacity: .65, marginBottom: '.8em' }}>{source?.name || clean(item.source)}</div>
      <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', fontSize: '1em', fontWeight: 600, lineHeight: 1.16, overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4, overflow: 'hidden' }}>{clean(item.title)}</a>
      <div style={{ fontSize: '.45em', opacity: .7, marginTop: '1em' }}>{item.author ? clean(item.author) + ' · ' : ''}{new Date(item.publishedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
    </article> : <div role="status" style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: '.75em' }}>{!selected.length && !custom ? 'Select news sources in Properties' : loading ? 'Loading headlines…' : 'Headlines temporarily unavailable'}</div>}
    <footer style={{ fontSize: '.4em', opacity: .65, flexShrink: 0, borderTop: '1px solid #84929a55', paddingTop: '.8em' }}>
      {source?.license ? <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{source.license} · Original headline</a> : <span>{item ? `Source: ${source?.name || clean(item.source)}` : 'Headlines refresh automatically'}</span>}
      <span style={{ float: 'right' }}>{anyError ? 'Some feeds delayed' : 'Refreshes every 5 minutes'}</span>
    </footer>
  </div>;
}
