/**
 * Help content truth guards + search (Muse beta DOC-001..012, 2026-10-11).
 * Reads the real articles from disk, so a regression in the copy or in the
 * search fails here.
 */
import fs from 'node:fs';
import path from 'node:path';
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
    expect(assets.body).toMatch(/500 MB/);
    expect(assets.body).not.toMatch(/up to (20|50|200) MB/i);
  });

  it('API docs match what the API really does (2026-10-11)', () => {
    const api = articles.find((a) => a.slug === 'api-and-webhooks')!;
    // Scopes = API_KEY_SCOPES in apps/api/src/api-keys/api-key-scopes.ts.
    for (const s of ['content:read', 'content:write', 'screens:read', 'screens:write', 'sports:read', 'sports:write', 'integrations:read', 'integrations:write', 'analytics:read']) {
      expect(api.body).toContain(`\`${s}\``);
    }
    expect(api.body).not.toMatch(/analytics:write/);
    expect(api.body).toMatch(/Authorization: Bearer vos_/);
    expect(api.body).toMatch(/90 days/);
    expect(api.body).toMatch(/365 days/);
    // Signature = HMAC-SHA256(secret, `${timestamp}.${body}`) — webhook-dispatch.service.ts.
    expect(api.body).toMatch(/X-VenueOS-Signature/);
    expect(api.body).toMatch(/\$\{ts\}\.\$\{req\.body/);
    // emergency.cleared is subscribable but never dispatched: the docs must say so.
    expect(api.body).toMatch(/`emergency\.cleared`[^\n]*not delivered yet/);
    expect(api.body).toMatch(/cannot be sent with an API key/i);
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

describe('IT & security section + public security pages (2026-10-22)', () => {
  const itSlugs = articles.filter((a) => a.category === 'IT & Security').map((a) => a.slug);

  it('ships the IT & security articles, each in en + es + zh', () => {
    expect(itSlugs).toEqual(['it-security-overview', 'network-requirements']);
    for (const slug of itSlugs) {
      const a = articles.find((x) => x.slug === slug)!;
      for (const loc of ['es', 'zh'] as const) {
        const tr = a.translations?.[loc];
        expect(tr).toBeDefined();
        expect(tr!.title).not.toBe(a.title);
        expect(tr!.body.length).toBeGreaterThan(400);
        // Same structure: a translation keeps every internal link of the original.
        expect((tr!.body.match(/\]\(\//g) || []).length).toBe((a.body.match(/\]\(\//g) || []).length);
      }
    }
  });

  it('never claims a certification VenueOS does not hold, nor SAML', () => {
    for (const slug of itSlugs) {
      const a = articles.find((x) => x.slug === slug)!;
      for (const body of [a.body, a.translations?.es?.body ?? '', a.translations?.zh?.body ?? '']) {
        expect(body).not.toMatch(/SOC ?2|ISO ?27001|FedRAMP|HIPAA|SAML/i);
      }
    }
  });

  it('tells IT teams the network is outbound-443-only and names the real hosts', () => {
    const net = articles.find((a) => a.slug === 'network-requirements')!;
    expect(net.body).toMatch(/Outbound HTTPS \(TCP 443\)/);
    for (const host of ['venue-os.app', 'api-production-39a1.up.railway.app', 'bhdaxzfalaycfopvcopm.supabase.co', 'wss://']) {
      expect(net.body).toContain(host);
    }
  });

  it('playlists help matches the product: no Schedules page, durations in seconds', () => {
    const pl = articles.find((a) => a.slug === 'playlists-and-schedules')!;
    expect(pl.body).not.toMatch(/milliseconds|Schedules → New schedule|Priority —/);
    const gs = articles.find((a) => a.slug === 'getting-started')!;
    expect(gs.body).not.toMatch(/Schedules → New schedule/);
  });

  it('security.txt is valid: contact, an Expires within a year, and the policy page', () => {
    const txt = fs.readFileSync(path.join(process.cwd(), 'public', '.well-known', 'security.txt'), 'utf8');
    expect(txt).toMatch(/^Contact: mailto:security@venue-os\.app$/m);
    expect(txt).toMatch(/^Policy: https:\/\/venue-os\.app\/security$/m);
    expect(txt).toMatch(/^Preferred-Languages: en$/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(txt)![1]);
    // RFC 9116 asks for less than a year. This goes red when the date passes —
    // that is the reminder to renew it.
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires - Date.now()).toBeLessThan(366 * 24 * 3600 * 1000);
    expect(fs.existsSync(path.join(process.cwd(), 'src', 'app', 'security', 'page.tsx'))).toBe(true);
  });
});
