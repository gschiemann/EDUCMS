// Server-only loader. Reads the .md files at module-load time. Do NOT import
// this file from a client component; use '@/content/help/types' instead for
// shared types and static metadata.

import fs from 'node:fs';
import path from 'node:path';
import type { HelpArticle, HelpCategory } from './types';

export type { HelpArticle, HelpCategory } from './types';
export { HELP_CATEGORIES } from './types';

function parse(slug: string, raw: string): HelpArticle {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { slug, title: slug, category: 'Getting Started', updated: '', excerpt: '', body: raw };
  }
  const [, fm, body] = match;
  const meta: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    meta[k] = v;
  }
  return {
    slug,
    title: meta.title || slug,
    category: (meta.category as HelpCategory) || 'Getting Started',
    updated: meta.updated || '',
    excerpt: meta.excerpt || '',
    body: body.trim(),
  };
}

const SLUG_ORDER = [
  'getting-started',
  'invite-users',
  'build-a-template',
  'template-best-practices',
  'assets',
  'pair-a-screen',
  'screen-groups',
  'playlists-and-schedules',
  'kiosk-hardening',
  'emergency-system',
  'panic-delegation',
  'sso',
  'clever',
  'billing',
];

let cached: HelpArticle[] | null = null;

export function getAllArticles(): HelpArticle[] {
  if (cached) return cached;
  const dir = path.join(process.cwd(), 'src', 'content', 'help');
  const articles = SLUG_ORDER.map((slug) => {
    const raw = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8');
    return parse(slug, raw);
  });
  cached = articles;
  return articles;
}

export function getArticle(slug: string): HelpArticle | undefined {
  return getAllArticles().find((a) => a.slug === slug);
}
