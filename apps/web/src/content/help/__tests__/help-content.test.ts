/**
 * Help content truth guards + search (Muse beta DOC-001..012, 2026-10-11).
 * Reads the real articles from disk, so a regression in the copy or in the
 * search fails here.
 */
import { getAllArticles } from '../index';
import { searchArticles, stem } from '../search';

const articles = getAllArticles();
const slugs = (q: string) => searchArticles(articles, q).map((a) => a.slug);

describe('help articles — copy that must stay true', () => {
  it('every article has a title, a plain-text excerpt and a body', () => {
    for (const a of articles) {
      expect(a.title.trim()).not.toBe('');
      expect(a.excerpt.trim().length).toBeGreaterThan(20);
      expect(a.excerpt).not.toMatch(/https?:\/\/|^\/|\]\(/);
      expect(a.body.length).toBeGreaterThan(200);
    }
  });

  it('never shows raw role enums (the product says Super Admin / Admin / Editor / Viewer)', () => {
    for (const a of articles) {
      expect(`${a.title}\n${a.body}`).not.toMatch(/\b(SUPER_ADMIN|DISTRICT_ADMIN|SCHOOL_ADMIN|CONTRIBUTOR|RESTRICTED_VIEWER)\b/);
    }
  });

  it('does not tell customers to integrate through the emergency API (API keys are blocked there)', () => {
    for (const a of articles) {
      expect(a.body).not.toMatch(/POST \/api\/v1\/emergency/);
    }
    const em = articles.find((a) => a.slug === 'emergency-system')!;
    expect(em.body).toMatch(/LIVE \| DRILL/);
    expect(em.body).toMatch(/THIS IS A DRILL/);
  });

  it('has no phantom "District plan", no "licence", no "an VenueOS"', () => {
    for (const a of articles) {
      expect(a.body).not.toMatch(/District plan/i);
      expect(a.body).not.toMatch(/licence/i);
      expect(a.body).not.toMatch(/\ban VenueOS/);
    }
  });

  it('does not claim a bulk CSV invite or a Settings → Users page (neither exists)', () => {
    const invite = articles.find((a) => a.slug === 'invite-users')!;
    expect(invite.body).not.toMatch(/Bulk invite/);
    for (const a of articles) {
      expect(a.body).not.toMatch(/Settings → (Users|Team)\b/);
    }
  });

  it('says one thing about pairing: the screen shows the code, you type it in the dashboard', () => {
    const pair = articles.find((a) => a.slug === 'pair-a-screen')!;
    expect(pair.body).not.toMatch(/Generate pairing code/i);
    expect(pair.body).toMatch(/shown \*\*on the screen\*\*/);
  });

  it('states the real upload limits in both the article and not the old ones', () => {
    const assets = articles.find((a) => a.slug === 'assets')!;
    expect(assets.body).toMatch(/25 MB/);
    expect(assets.body).toMatch(/2 GB/);
    expect(assets.body).not.toMatch(/up to (20|50|200) MB/i);
  });

  it('does not promise a "17 system templates" gallery', () => {
    for (const a of articles) expect(a.body).not.toMatch(/\b17 system templates\b/);
  });
});

describe('help search', () => {
  it('stems the words operators actually type', () => {
    expect(stem('pairing')).toBe(stem('paired'));
    expect(stem('pairing')).toBe('pair');
    expect(stem('approvals')).toBe('approval');
  });

  it('returns everything for an empty query and nothing for gibberish', () => {
    expect(searchArticles(articles, '   ')).toHaveLength(articles.length);
    expect(searchArticles(articles, 'zzqxjv')).toHaveLength(0);
  });

  it('finds the pairing article for pair / pairing / paired', () => {
    for (const q of ['pair', 'pairing', 'how to pair a screen', 'paired']) {
      expect(slugs(q)).toContain('pair-a-screen');
    }
  });

  it('treats test and drill as the same idea', () => {
    expect(slugs('drill')).toContain('emergency-system');
    expect(slugs('test')).toContain('emergency-system');
    expect(slugs('testing alerts')).toContain('emergency-system');
  });

  it('finds approval articles from approve / approval / approvals', () => {
    for (const q of ['approve', 'approval', 'approvals']) {
      expect(slugs(q).length).toBeGreaterThan(0);
      expect(slugs(q)).toContain('assets');
    }
  });

  it('finds the API-key material for "api key" and "api keys"', () => {
    expect(slugs('api key')).toContain('generate-with-ai');
    expect(slugs('API keys')).toContain('generate-with-ai');
  });

  it('searches article bodies, not just titles', () => {
    // "HEIC" only appears in the assets article body.
    expect(slugs('heic')).toContain('assets');
  });

  it('ranks a title match above a body-only match', () => {
    const r = slugs('pair a screen');
    expect(r[0]).toBe('pair-a-screen');
  });

  it('requires every word to be found', () => {
    expect(slugs('pair zzqxjv')).toHaveLength(0);
  });
});
