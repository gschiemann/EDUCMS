/**
 * INJ-003 — write-time URL validation for template zone config.
 *
 * `TemplateZone.defaultConfig` is `z.any()` at the API boundary and was
 * persisted verbatim by both `POST /templates` and `PUT /templates/:id/zones`.
 * For the three widget types whose config carries a URL the PLAYER turns into
 * a live network reference — an iframe `src` (WEBPAGE, EXTERNAL_HTML) or a
 * video `src` (STREAMING) — an operator-supplied `javascript:` / `data:`
 * payload rode straight through to a screen with no server-side check.
 *
 * This is a SCHEME / SSRF gate, deliberately NOT a host allowlist: embedding
 * third-party pages and streams is a shipped feature, so the tests below pin
 * BOTH halves — hostile schemes are refused AND ordinary external https URLs
 * plus the root-relative shape every shipped EXTERNAL_HTML board uses
 * (`/templates/hs/varsity.html`) keep working.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppRole } from '@cms/database';
import { assertZoneUrlsSafe, assertZoneUrlValueSafe } from './zone-url-guard';
import { TemplatesController } from './templates.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { RedisService } from '../realtime/redis.service';

const webpage = (url: unknown) => [
  { name: 'Frame', widgetType: 'WEBPAGE', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url } },
];
const externalHtml = (url: unknown) => [
  { name: 'Board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { url } },
];

describe('zone-url-guard — hostile schemes are refused', () => {
  const hostile: Array<[string, string]> = [
    ['javascript:', 'javascript:alert(document.cookie)'],
    ['javascript: uppercase', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['blob:', 'blob:https://example.com/1234'],
    ['file:', 'file:///etc/passwd'],
    ['intent: (Android JS-bridge reach)', 'intent://scan/#Intent;scheme=zxing;end'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['about:', 'about:blank'],
  ];

  it.each(hostile)('rejects %s', (_label, url) => {
    expect(() => assertZoneUrlsSafe(webpage(url))).toThrow(HttpException);
    expect(() => assertZoneUrlsSafe(externalHtml(url))).toThrow(HttpException);
  });

  it('rejects with 400 + a machine-readable code naming the zone and field', () => {
    try {
      assertZoneUrlsSafe(webpage('javascript:alert(1)'));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(e.getResponse()).toMatchObject({
        code: 'TEMPLATE_ZONE_URL_REJECTED',
        zone: 'Frame',
        field: 'url',
      });
    }
  });
});

describe('zone-url-guard — control-character smuggling', () => {
  // Browsers STRIP \n / \t / \r while parsing a URL, so `java\nscript:` runs
  // as `javascript:`. A naive `startsWith('javascript:')` test misses it.
  const smuggled = [
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'java\rscript:alert(1)',
    'jav\u0000ascript:alert(1)',
    '\u0001javascript:alert(1)',
    'https://example.com/\u007Fpath',
  ];

  it.each(smuggled)('rejects %j', (url) => {
    expect(() => assertZoneUrlsSafe(webpage(url))).toThrow(HttpException);
  });

  it('the rejection reason says it was control characters (not a confusing scheme error)', () => {
    try {
      assertZoneUrlsSafe(webpage('java\nscript:alert(1)'));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect((e.getResponse() as any).message).toMatch(/control characters/i);
    }
  });
});

describe('zone-url-guard — relative + scheme-relative shapes', () => {
  it('ACCEPTS the root-relative shape every shipped EXTERNAL_HTML board uses', () => {
    expect(() => assertZoneUrlsSafe(externalHtml('/templates/hs/varsity.html'))).not.toThrow();
    expect(() => assertZoneUrlsSafe(externalHtml('/templates/signage/qsr/redesign-sushi-ramen-after-dark.html?orientation=portrait'))).not.toThrow();
  });

  it('ACCEPTS the sports direct-mode surfaces (/board, /ribbon, /scorebug)', () => {
    for (const u of ['/board/abc123', '/ribbon/abc123', '/scorebug/abc123']) {
      expect(() => assertZoneUrlsSafe(webpage(u))).not.toThrow();
    }
  });

  it('treats scheme-relative //host as https://host and validates it', () => {
    expect(() => assertZoneUrlsSafe(webpage('//example.com/news'))).not.toThrow();
    expect(() => assertZoneUrlsSafe(webpage('//127.0.0.1/admin'))).toThrow(HttpException);
  });

  it('BACKSLASH forms cannot masquerade as root-relative (WHATWG treats \\ as / for https pages)', () => {
    // Pre-fix these slipped through the root-relative early-return and the
    // iframe then resolved them to an off-origin — including loopback.
    expect(() => assertZoneUrlsSafe(webpage('/\\127.0.0.1/admin'))).toThrow(HttpException);
    expect(() => assertZoneUrlsSafe(webpage('\\\\127.0.0.1/admin'))).toThrow(HttpException);
    expect(() => assertZoneUrlsSafe(webpage('/\\10.0.0.5/internal'))).toThrow(HttpException);
    // …but a legitimate public host in the same shape is still fine.
    expect(() => assertZoneUrlsSafe(webpage('/\\example.com/news'))).not.toThrow();
  });
});

describe('zone-url-guard — SSRF / private-range hosts', () => {
  it.each([
    'https://127.0.0.1/admin',
    'https://10.0.0.5/internal',
    'https://192.168.1.1/router',
    'https://169.254.169.254/latest/meta-data/',
    // Bracketed IPv6: `new URL(...).hostname` keeps the brackets and
    // node's isIP() returns 0 for "[::1]", so safe-fetch's IP-literal test
    // never fires — the guard strips the brackets itself.
    'https://[::1]/admin',
    'https://[fd00::1]/internal',
    // `localhost` by NAME is not an IP literal at all, but on a kiosk it is
    // the screen's own loopback.
    'https://localhost/admin',
    'https://api.localhost/admin',
  ])('rejects %s', (url) => {
    expect(() => assertZoneUrlsSafe(webpage(url))).toThrow(HttpException);
  });

  it('a public LAN-style hostname is still allowed — on-prem dashboards are a real, shipped use of WEBPAGE', () => {
    expect(() => assertZoneUrlsSafe(webpage('https://intranet.district.org/dashboard'))).not.toThrow();
  });

  it('rejects plain http:// in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => assertZoneUrlsSafe(webpage('http://example.com'))).toThrow(HttpException);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('zone-url-guard — ordinary third-party embedding keeps working', () => {
  it.each([
    'https://example.com',
    'https://www.google.com/calendar/embed?src=abc',
    'https://player.twitch.tv/?channel=x&parent=y',
    'https://cdn.example.com/live/stream.m3u8',
    'example.com/news', // bare domain — WebpageWidget auto-prefixes https://
  ])('accepts %s', (url) => {
    expect(() => assertZoneUrlsSafe(webpage(url))).not.toThrow();
  });

  it('a bare host:port is judged as an authority, not as a bogus scheme', () => {
    // Pre-fix this took the scheme branch and reported
    // `Disallowed URL scheme "example.com:"`. It is still refused (the
    // shipped stream-URL validator enforces 80/443 too) but the operator now
    // gets an honest port message.
    try {
      assertZoneUrlsSafe(webpage('example.com:8443/live.m3u8'));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect((e.getResponse() as any).message).toMatch(/port/i);
    }
  });

  it('leaves widgets with no URL field alone, and tolerates missing/odd config', () => {
    expect(() => assertZoneUrlsSafe([{ name: 'Clock', widgetType: 'CLOCK', defaultConfig: { url: 'javascript:alert(1)' } } as any])).not.toThrow();
    expect(() => assertZoneUrlsSafe(webpage(undefined))).not.toThrow();
    expect(() => assertZoneUrlsSafe(webpage(''))).not.toThrow();
    expect(() => assertZoneUrlsSafe(webpage(42))).not.toThrow();
    expect(() => assertZoneUrlsSafe(undefined)).not.toThrow();
  });

  it('reads defaultConfig whether it arrives as an object or as the DB JSON string', () => {
    const asString = [{ name: 'Board', widgetType: 'EXTERNAL_HTML', defaultConfig: JSON.stringify({ url: 'javascript:alert(1)' }) }];
    expect(() => assertZoneUrlsSafe(asString as any)).toThrow(HttpException);
  });
});

describe('zone-url-guard — STREAMING carries THREE dereferenced URL fields', () => {
  const streaming = (config: any) => [
    { name: 'Stream', widgetType: 'STREAMING', x: 0, y: 0, width: 100, height: 100, defaultConfig: config },
  ];

  it('guards playbackUrl and embedUrl', () => {
    expect(() => assertZoneUrlsSafe(streaming({ playbackUrl: 'javascript:alert(1)' }))).toThrow(HttpException);
    expect(() => assertZoneUrlsSafe(streaming({ embedUrl: 'data:text/html,<script>x</script>' }))).toThrow(HttpException);
    expect(() => assertZoneUrlsSafe(streaming({ playbackUrl: 'https://cdn.example.com/a.m3u8', embedUrl: 'https://player.twitch.tv/?channel=x' }))).not.toThrow();
  });

  it('guards playbackUrlVariants[].url — the per-codec list pickBestVideo() feeds straight to <video src>', () => {
    expect(() =>
      assertZoneUrlsSafe(
        streaming({
          playbackUrl: 'https://cdn.example.com/h264.m3u8',
          playbackUrlVariants: [
            { url: 'https://cdn.example.com/av1.m3u8', codec: 'av1' },
            { url: 'data:text/html;base64,PHNjcmlwdD4x', codec: 'h264' },
          ],
        }),
      ),
    ).toThrow(HttpException);
  });

  it('a clean variant list is accepted', () => {
    expect(() =>
      assertZoneUrlsSafe(
        streaming({
          playbackUrlVariants: [
            { url: 'https://cdn.example.com/av1.m3u8', codec: 'av1' },
            { url: 'https://cdn.example.com/h264.m3u8', codec: 'h264' },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('zone-url-guard — single-value helper', () => {
  it('ignores non-strings and empties, throws on hostile', () => {
    expect(() => assertZoneUrlValueSafe('z', 'url', null)).not.toThrow();
    expect(() => assertZoneUrlValueSafe('z', 'url', '   ')).not.toThrow();
    expect(() => assertZoneUrlValueSafe('z', 'url', 'javascript:alert(1)')).toThrow(HttpException);
    // Leading/trailing whitespace must not smuggle a scheme past the check.
    expect(() => assertZoneUrlValueSafe('z', 'url', '   javascript:alert(1)   ')).toThrow(HttpException);
  });
});

// ── Wired into BOTH write paths ──────────────────────────────────────
describe('zone-url-guard — actually applied at POST /templates and PUT /templates/:id/zones', () => {
  let controller: TemplatesController;
  let prismaService: any;
  const admin = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };

  beforeEach(async () => {
    const tpl = { id: 'tpl1', tenantId: 't1', isSystem: false, updatedAt: new Date('2026-08-02T12:00:00Z'), name: 'B' };
    prismaService = {
      client: {
        template: {
          findFirst: jest.fn().mockResolvedValue(tpl),
          findUnique: jest.fn().mockResolvedValue({ ...tpl, zones: [] }),
          create: jest.fn().mockResolvedValue({ ...tpl, zones: [] }),
          update: jest.fn().mockResolvedValue({ ...tpl, zones: [] }),
        },
        templateZone: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
        templateVersion: {
          create: jest.fn().mockResolvedValue({ id: 'v' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        tenantBranding: { findUnique: jest.fn().mockResolvedValue(null) },
        schedule: { findFirst: jest.fn().mockResolvedValue(null) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn().mockImplementation((opsOrFn: any) =>
          typeof opsOrFn === 'function' ? opsOrFn(prismaService.client) : Promise.all(opsOrFn),
        ),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        { provide: PrismaService, useValue: prismaService },
        { provide: AiService, useValue: {} },
        { provide: BrandingScraperService, useValue: {} },
        { provide: SupabaseStorageService, useValue: {} },
        { provide: JwtService, useValue: { sign: jest.fn(), verifyAsync: jest.fn() } },
        { provide: RedisService, useValue: { sismember: jest.fn().mockResolvedValue(false) } },
      ],
    }).compile();
    controller = module.get<TemplatesController>(TemplatesController);
  });

  it('PUT /:id/zones refuses a javascript: zone URL and never writes zones', async () => {
    await expect(
      controller.replaceZones(admin, 'tpl1', { zones: webpage('javascript:alert(1)') } as any),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST, response: { code: 'TEMPLATE_ZONE_URL_REJECTED' } });
    expect(prismaService.client.$transaction).not.toHaveBeenCalled();
  });

  it('PUT /:id/zones accepts a normal https URL and a root-relative board path', async () => {
    await expect(
      controller.replaceZones(admin, 'tpl1', {
        zones: [...webpage('https://example.com/news'), ...externalHtml('/templates/hs/varsity.html')],
      } as any),
    ).resolves.toBeTruthy();
    expect(prismaService.client.templateZone.deleteMany).toHaveBeenCalled();
  });

  it('POST /templates refuses a javascript: zone URL at creation time too', async () => {
    await expect(
      controller.create(admin, { name: 'New', zones: webpage('javascript:alert(1)') } as any),
    ).rejects.toMatchObject({ response: { code: 'TEMPLATE_ZONE_URL_REJECTED' } });
    expect(prismaService.client.template.create).not.toHaveBeenCalled();
  });
});
