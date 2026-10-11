// Client-safe help search (DOC-008, 2026-10-11). Pure, no I/O.
//
// Word-wise, not substring-wise: the query is split into words, every word
// must be found (in the title, a heading, the excerpt, the category or the
// body), and a word matches by simple stem — "pairing" finds "pair",
// "approvals" finds "approve" — or by a short synonym group ("test" and
// "drill" are the same idea here). Results are ranked: title > heading >
// excerpt/category > body.
//
// Cheap on purpose: a per-article word index is built once, lazily, and the
// whole corpus is ~25 articles. No dependency.

import type { HelpArticle } from './types';

/** Light English stemmer: enough for help vocabulary, not linguistics. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) {
    w = w.slice(0, -3);
    // "pairing" -> "pair"; "scheduling" -> "schedul" (matches "schedule"/"scheduled")
    return w;
  }
  if (w.endsWith('ed') && w.length > 4) return w.endsWith('ied') ? w.slice(0, -3) + 'y' : w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

/**
 * Synonym groups, by STEM. Any member of a group matches every other member.
 * Keep this short and honest: each line is a pair of words an operator uses
 * for the same thing in this product.
 */
const SYNONYM_GROUPS: string[][] = [
  ['pair', 'connect', 'register', 'activat'],
  ['test', 'drill', 'practic', 'rehears', 'simulat'],
  ['key', 'token', 'apikey'],
  ['approv', 'review', 'submission', 'sign-off'],
  ['alert', 'emergency', 'panic', 'lockdown'],
  ['screen', 'display', 'tv', 'monitor', 'kiosk'],
  ['user', 'staff', 'team', 'member', 'peopl'],
  ['invit', 'add'],
  ['delet', 'remov'],
  ['templat', 'board', 'layout'],
];

const SYN = new Map<string, string[]>();
for (const g of SYNONYM_GROUPS) for (const m of g) SYN.set(m, g);

/** Query words that carry no meaning for matching. */
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'how', 'do', 'i', 'my', 'is', 'it', 'with']);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_>#|[\]()]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "api key" typed as "apikey", and the reverse, should meet in the middle. */
function expandQueryWords(raw: string): string[][] {
  const ws = words(raw).filter((w) => !STOP.has(w));
  return ws.map((w) => {
    const s = stem(w);
    const set = new Set<string>([s]);
    for (const m of SYN.get(s) ?? []) set.add(m);
    return [...set];
  });
}

interface Index {
  title: Set<string>;
  headings: Set<string>;
  lead: Set<string>; // excerpt + category
  body: Set<string>;
}

const cache = new WeakMap<HelpArticle, Index>();

function indexOf(a: HelpArticle): Index {
  let idx = cache.get(a);
  if (idx) return idx;
  const headings = a.body
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .join(' ');
  const stems = (t: string) => new Set(words(t).map(stem));
  idx = {
    title: stems(a.title),
    headings: stems(headings),
    lead: stems(`${a.excerpt} ${a.category}`),
    body: stems(a.body),
  };
  cache.set(a, idx);
  return idx;
}

/** Does any alternative match a stem in the set (equal, or prefix of length >= 4)? */
function hit(set: Set<string>, alts: string[]): boolean {
  for (const alt of alts) {
    if (set.has(alt)) return true;
  }
  if (set.size === 0) return false;
  for (const alt of alts) {
    if (alt.length < 4) continue;
    for (const s of set) if (s.startsWith(alt) || (s.length >= 4 && alt.startsWith(s))) return true;
  }
  return false;
}

/** Filter + rank. Empty query returns the input unchanged (original order). */
export function searchArticles(articles: HelpArticle[], query: string): HelpArticle[] {
  const q = expandQueryWords(query);
  if (q.length === 0) return query.trim() ? [] : articles;
  const scored: Array<{ a: HelpArticle; score: number; i: number }> = [];
  articles.forEach((a, i) => {
    const idx = indexOf(a);
    let score = 0;
    for (const alts of q) {
      let best = 0;
      if (hit(idx.title, alts)) best = 10;
      else if (hit(idx.headings, alts)) best = 6;
      else if (hit(idx.lead, alts)) best = 3;
      else if (hit(idx.body, alts)) best = 1;
      if (best === 0) return; // every word must be found somewhere
      score += best;
    }
    scored.push({ a, score, i });
  });
  return scored.sort((x, y) => y.score - x.score || x.i - y.i).map((s) => s.a);
}
