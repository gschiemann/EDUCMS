export const NEWSROOM_LAYOUTS = [
  ["front-page", "Front Page"],
  ["broadcast", "Broadcast"],
  ["briefing", "The Briefing"],
  ["ribbon", "Headline Ribbon"],
  ["banner", "Scrolling Banner"],
] as const;
export const NEWSROOM_SCOPES = [
  ["local", "Local"],
  ["national", "National"],
  ["world", "International"],
] as const;
export type NewsScope = (typeof NEWSROOM_SCOPES)[number][0];
export interface NewsArticle {
  title: string;
  link: string;
  publisher: string;
  indexedAt: string;
  scope: NewsScope;
}
export interface NewsResult {
  items: NewsArticle[];
  fetchedAt: string;
  location: string;
  scope: NewsScope;
  provider: "GDELT";
  stale?: boolean;
  limited?: boolean;
}
export const NEWSROOM_PUBLISHERS = [
  ["eastbaytimes.com", "East Bay Times"],
  ["mercurynews.com", "The Mercury News"],
  ["danvillesanramon.com", "Danville / San Ramon"],
  ["apnews.com", "Associated Press"],
  ["reuters.com", "Reuters"],
  ["bbc.com", "BBC"],
  ["theguardian.com", "The Guardian"],
  ["cnn.com", "CNN"],
] as const;
export const NEWSROOM_PALETTES = {
  "front-page": { background: "#f3efe5", text: "#19271f", accent: "#bc3b27" },
  broadcast: { background: "#101d32", text: "#f5f6ef", accent: "#d4fa67" },
  briefing: { background: "#ecf1ef", text: "#143b35", accent: "#c3472d" },
  banner: { background: "#11252b", text: "#ffffff", accent: "#e6bc74" },
  ribbon: { background: "#11252b", text: "#ffffff", accent: "#e6bc74" },
} as const;
/** Round robin across scopes AND publishers; remove syndicated duplicates.
 * Don't let one prolific feed occupy the entire display. */
export function balanceNews(
  results: NewsResult[],
  now = Date.now(),
): NewsArticle[] {
  const seen = new Set<string>();
  const groups = results.map((r) => {
    const counts = new Map<string, number>();
    return (Array.isArray(r.items) ? r.items : []).filter((a) => {
      const date = Date.parse(a.indexedAt);
      if (
        !/^https?:\/\//i.test(a.link) ||
        !a.title.trim() ||
        !Number.isFinite(date) ||
        date < now - 7 * 86400000 ||
        date > now + 3600000
      )
        return false;
      const count = counts.get(a.publisher) || 0;
      counts.set(a.publisher, count + 1);
      return count < 4;
    });
  });
  const mixed: NewsArticle[] = [];
  for (let i = 0; i < 32; i++)
    for (const group of groups) {
      const a = group[i];
      if (!a) continue;
      const title = a.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(a.link) || seen.has(title)) continue;
      seen.add(a.link);
      seen.add(title);
      mixed.push(a);
    }
  return mixed.slice(0, 36);
}
export function newsroomScopes(value: unknown): NewsScope[] {
  return Array.isArray(value)
    ? NEWSROOM_SCOPES.map((s) => s[0]).filter((s) => value.includes(s))
    : ["local", "national", "world"];
}
export function backgroundWithOpacity(value: string, opacity: number): string {
  if (value === "transparent") return value;
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (!hex) return value;
  const n = parseInt(hex[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, opacity)) / 100})`;
}
