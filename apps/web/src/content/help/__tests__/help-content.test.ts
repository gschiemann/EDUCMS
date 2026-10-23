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
    expect(itSlugs).toEqual(['it-security-overview', 'signing-in', 'network-requirements']);
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
    // GitHub private vulnerability reporting (repo public + PVR enabled, 2026-10-22).
    expect(txt).toMatch(/^Contact: https:\/\/github\.com\/gschiemann\/EDUCMS\/security\/advisories\/new$/m);
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

/**
 * Signing-in + emergency-broadcast articles (2026-10-22). Every number these
 * articles state is read back from the code that enforces it, so a change to a
 * limit turns this red until the article (in all three languages) follows.
 */
describe('signing-in and emergency-broadcast articles match the product', () => {
  const repo = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), '..', ...p), 'utf8');
  /** `NAME = 7 * 24 * 60 * 60_000;` → the product of the factors. */
  const constant = (src: string, name: string): number => {
    const m = new RegExp(`\\b${name} = ([\\d_ *]+);`).exec(src);
    if (!m) throw new Error(`${name} not found — did the constant move?`);
    return m[1].split('*').reduce((acc, f) => acc * Number(f.trim().replace(/_/g, '')), 1);
  };
  const article = (slug: string) => articles.find((a) => a.slug === slug)!;
  const bodies = (slug: string) => {
    const a = article(slug);
    return [a.body, a.translations?.es?.body ?? '', a.translations?.zh?.body ?? ''];
  };
  const links = (s: string) => (s.match(/\]\(\/[^)]+\)/g) || []).sort();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('both ship in en + es + zh, translated, with the same internal links', () => {
    for (const slug of ['signing-in', 'emergency-broadcast']) {
      const a = article(slug);
      expect(a).toBeDefined();
      for (const loc of ['es', 'zh'] as const) {
        const tr = a.translations?.[loc];
        expect(tr).toBeDefined();
        expect(tr!.title).not.toBe(a.title);
        expect(tr!.body.length).toBeGreaterThan(2000);
        expect(links(tr!.body)).toEqual(links(a.body));
      }
    }
  });

  it('signing-in states the sign-in limits the API enforces', () => {
    const en = article('signing-in').body;
    const backup = constant(repo('api', 'src', 'auth', 'mfa-backup-codes.ts'), 'BACKUP_CODE_COUNT');
    const passkeys = constant(repo('api', 'src', 'auth', 'passkey-limits.ts'), 'MAX_PASSKEYS_PER_USER');
    const limiter = repo('api', 'src', 'auth', 'login-attempt-limiter.ts');
    const emailCode = repo('api', 'src', 'auth', 'mfa-email-code.ts');
    const onboarding = repo('api', 'src', 'onboarding', 'onboarding.service.ts');
    const setupLink = repo('api', 'src', 'auth', 'account-setup-link.ts');

    expect(en).toContain(`shows ${backup} backup codes`);
    expect(en).toContain(`up to ${passkeys} passkeys`);
    expect(en).toContain(`after ${constant(limiter, 'LOGIN_LOCK_AFTER')} in ${constant(limiter, 'LOGIN_FAIL_WINDOW_MS') / MIN} minutes`);
    expect(en).toContain(`pauses that email for ${constant(limiter, 'LOGIN_LOCK_MS') / MIN} minutes`);
    expect(constant(onboarding, 'PASSWORD_RESET_TTL_MS')).toBe(HOUR);
    expect(en).toMatch(/reset link works for one hour/);
    expect(en).toContain(`it works for ${constant(onboarding, 'INVITE_TTL_MS') / DAY} days`);
    expect(en).toContain(`expires after ${constant(setupLink, 'SETUP_LINK_TTL_MS') / DAY} days`);
    expect(en).toContain(`works once, for ${constant(emailCode, 'MFA_EMAIL_CODE_TTL_MS') / MIN} minutes`);
    expect(en).toContain(`not offered for ${constant(emailCode, 'MFA_EMAIL_CODE_RESET_COOLDOWN_MS') / DAY} days after a password reset`);
    for (const body of bodies('signing-in')) {
      expect(body).toContain('venue-os.app/login');
      expect(body).not.toMatch(/SAML|SOC ?2|ISO ?27001|FedRAMP|HIPAA/i);
    }
  });

  it('emergency-broadcast states what the Broadcast page and the API really do', () => {
    const en = article('emergency-broadcast').body;
    const page = fs.readFileSync(path.join(process.cwd(), 'src', 'app', '[schoolId]', 'emergency', 'broadcast', 'page.tsx'), 'utf8');
    const api = repo('api', 'src', 'emergency', 'emergency.controller.ts');

    // Hold-to-send, the duration range and its default.
    expect(constant(page, 'HOLD_MS')).toBe(3000);
    expect(page).toMatch(/min=\{1\}\s+max=\{120\}/);
    expect(page).toMatch(/\[durationMin, setDurationMin\] = useState\(5\)/);
    expect(en).toContain('from 1 to 120 minutes. The default is 5');
    // Built-in lifetimes: text 5 min unless set, media 1 hour, SOS 30 minutes.
    expect(api).toMatch(/new Date\(Date\.now\(\) \+ 60 \* 60 \* 1000\); \/\/ 1 hr default/);
    expect(api).toMatch(/new Date\(Date\.now\(\) \+ 30 \* 60 \* 1000\); \/\/ 30 min/);
    expect(en).toMatch(/\| Media alert \| 1 hour \|/);
    expect(en).toMatch(/\| Staff SOS \| 30 minutes \|/);
    // "Clear" follows the API's own rule since 2026-10-22 (admins + the
    // delegated panic flag, never a viewer) — the same capability that gates
    // sending — and the article says so.
    expect(page).toMatch(/const canClear = canSendAllClear\(user\) && !isViewer;/);
    expect(page).toMatch(/const canSend = hasPanicAuthority\(user\) && !isViewer;/);
    expect(en).toContain('**Clear** on this page is shown to everyone who can send');
    // A broadcast from an organization reaches the locations under it (the
    // poll and the clear fan out — emergency.district-propagation.spec.ts).
    expect(api).toMatch(/deviceMessagesWhere\(/);
    expect(api).toMatch(/clearTargetMessageIds\(/);
    expect(en).toContain('to every screen at those locations too');
    // The page has no LIVE | DRILL switch, and the article says so.
    expect(page).not.toMatch(/LiveDrillSwitch/);
    expect(en).toContain('no **LIVE | DRILL** switch');
    // Audit actions named in the article are the ones the controller writes.
    for (const action of ['BROADCAST_TEXT', 'MEDIA_ALERT', 'SOS_TRIGGER', 'CLEAR_EMERGENCY_MESSAGE']) {
      expect(api).toContain(`action: '${action}'`);
      for (const body of bodies('emergency-broadcast')) expect(body).toContain(`\`${action}\``);
    }
  });

  it('says plainly that no screen in the product sends an SOS yet', () => {
    // If a web surface starts calling the SOS endpoint, this goes red: update
    // the "Staff SOS and voice notes" section in all three languages.
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
        else if (/\.(tsx?|jsx?)$/.test(e.name) && /emergency\/sos\b/.test(fs.readFileSync(p, 'utf8'))) callers.push(p);
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(callers).toEqual([]);
    expect(article('emergency-broadcast').body).toMatch(/there is no button yet[^.]*to send an SOS or record a voice note/);
  });
});
