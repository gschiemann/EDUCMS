/**
 * Frontend mirror of apps/api/src/feeds/feeds.types.ts — kept as a plain
 * duplicate (not a shared package import) since apps/web and apps/api don't
 * share a types package for this domain and these shapes are tiny/stable.
 */

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string;
}

export interface CalendarFeedEvent {
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  allDay: boolean;
}
