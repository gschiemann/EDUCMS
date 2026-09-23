/**
 * POST /templates/concierge/reference/image — an uploaded logo or photo becomes
 * a checked, re-hosted ASSET; a design stays inspiration (2026-09-23).
 *
 * Before: every upload became a text summary (multer `memoryStorage`, never
 * stored), so an operator who uploaded their logo still got a typeset name.
 *
 * The chain is real end to end except the provider's HTTP reply: the REAL
 * AiAltTextService produces the analysis (its `role` included) from an
 * OpenAI-shaped reply, the REAL designer-assets gates decode real encodings,
 * and the bucket is in memory.
 */
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { ConciergeReferenceSchema, ConciergeChatSchema } from '@cms/api-types';
import { TemplatesController } from './templates.controller';
import { AiAltTextService } from '../ai/ai-alt-text.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { photoJpeg, wordmarkPng, isOrangeRed } from '../../test/supertaco-site';

jest.setTimeout(30_000);

const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;

const prismaMock: any = {
  client: {
    tenant: {
      findUnique: jest.fn(async () => ({ id: 'tenant-img', aiProvider: null, aiKeyEncrypted: null })),
      update: jest.fn(async () => ({})),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => data) },
  },
};

function visionReply(reply: Record<string, unknown>) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
  });
}

function memoryBucket(opts: { fail?: boolean } = {}) {
  const uploads: Array<{ path: string; contentType: string; buf: Buffer }> = [];
  return {
    uploads,
    upload: (path: string, buf: Buffer, contentType: string) => {
      if (opts.fail) return Promise.reject(new Error('storage down'));
      uploads.push({ path, contentType, buf });
      return Promise.resolve(`https://sb.example/storage/v1/object/public/assets/${path}`);
    },
  };
}

async function makeController(opts: { storage?: ReturnType<typeof memoryBucket>; withAltText?: boolean; ai?: any } = {}) {
  const module = await Test.createTestingModule({
    providers: [
      AiAltTextService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: RedisService, useValue: { publisher: null } },
    ],
  }).compile();
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  Object.assign(controller, {
    ai: opts.ai ?? { analyzeDesignReferenceImage: jest.fn() },
    storage: opts.storage ?? memoryBucket(),
    auditLogger: { warn: () => undefined, log: () => undefined },
    ...(opts.withAltText === false ? {} : { altText: module.get(AiAltTextService) }),
  });
  return controller;
}

const REQ = { user: { tenantId: 'tenant-img', id: 'u1', role: 'SCHOOL_ADMIN' } };
const file = (buffer: Buffer, mimetype: string, originalname: string) =>
  ({ buffer, mimetype, originalname, size: buffer.length }) as Express.Multer.File;

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  fetchMock.mockReset();
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('reference/image — the upload is the venue\'s LOGO', () => {
  it('comes back as OUR copy with source upload, a palette from its inks, and a summary that says so', async () => {
    visionReply({ summary: 'A bold orange and yellow wordmark with a sun mark.', palette: ['#ffffff', '#f76422'], role: 'logo' });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await wordmarkPng(1400, 392), 'image/png', 'logo.png'));

    expect(fetchMock).toHaveBeenCalledTimes(1); // the role came from the one vision call
    expect(ref.kind).toBe('image');
    expect(ref.label).toBe('logo.png');
    expect(ref.logoUrl).toMatch(/^https:\/\/sb\.example\/.*\/ai-designer\/tenant-img\/uploads\/[0-9a-f]{16}\.png$/);
    expect(ref.logoSource).toBe('upload');
    expect(ref.imageUrl).toBeUndefined();
    expect(isOrangeRed(ref.palette[0])).toBe(true);
    expect(ref.summary).toContain('A bold orange and yellow wordmark');
    expect(ref.summary).toContain("Logo: this upload is the venue's own logo, uploaded by the operator and checked (1400×392 PNG)");
    expect(ref.summary).not.toMatch(/verified/i);
    expect(bucket.uploads).toHaveLength(1);
  });

  it('an SVG logo is analysed as a PNG and stored as a PNG', async () => {
    visionReply({ summary: 'A flat two-color wordmark.', palette: ['#f76422'], role: 'logo' });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect x="10" y="30" width="580" height="100" fill="#f76422"/></svg>',
      'utf-8',
    );
    const ref: any = await controller.conciergeReferenceImage(REQ, file(svg, 'image/svg+xml', 'logo.svg'));
    const sent = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body).messages);
    expect(sent).toContain('data:image/png;base64,');
    expect(sent).not.toContain('image/svg+xml');
    expect(ref.logoUrl).toMatch(/\/uploads\/[0-9a-f]{16}\.png$/);
    expect(bucket.uploads.map((u) => u.contentType)).toEqual(['image/png']);
  });
});

describe('reference/image — the upload is one of their PHOTOS', () => {
  it('comes back as imageUrl with imageSource upload', async () => {
    visionReply({ summary: 'A warm close-up of birria tacos on a red tray.', palette: ['#8a2b0e', '#f2c14e'], role: 'photo' });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(1600, 1067, 31), 'image/jpeg', 'tacos.jpg'));
    expect(ref.imageUrl).toMatch(/\/ai-designer\/tenant-img\/uploads\/[0-9a-f]{16}\.jpg$/);
    expect(ref.imageSource).toBe('upload');
    expect(ref.logoUrl).toBeUndefined();
    expect(ref.palette).toEqual(['#8a2b0e', '#f2c14e']);
    expect(ref.summary).toContain("Photo: this upload is one of the venue's own photos, uploaded by the operator and checked (1600×1067)");
    const stored = await sharp(bucket.uploads[0].buf).metadata();
    expect(stored.format).toBe('jpeg');
  });

  it('a photo too small for the board is not used — and the summary says why', async () => {
    visionReply({ summary: 'A small photo of a storefront.', palette: [], role: 'photo' });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(640, 480, 32), 'image/jpeg', 'front.jpg'));
    expect(ref.imageUrl).toBeUndefined();
    expect(ref.imageSource).toBeUndefined();
    expect(bucket.uploads).toHaveLength(0);
    expect(ref.summary).toMatch(/could not be used \(too small: 640×480 \(needs a 800px short side\)\) — use none rather than invent one/);
  });

  it('our storage down: no URL at all (nothing to hotlink), and the summary says why', async () => {
    visionReply({ summary: 'Tacos.', palette: [], role: 'photo' });
    const controller = await makeController({ storage: memoryBucket({ fail: true }) });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(1600, 1067, 33), 'image/jpeg', 'x.jpg'));
    expect(ref.imageUrl).toBeUndefined();
    expect(ref.summary).toContain('could not be used (it could not be copied to our storage)');
  });
});

describe('reference/image — a DESIGN stays inspiration', () => {
  it('no asset, nothing stored, and the summary says it is for the look only', async () => {
    visionReply({ summary: 'A neon bar sign on dark brick — moody, high contrast.', palette: ['#ff2bd6', '#111111'], role: 'design' });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(1600, 1067, 34), 'image/jpeg', 'neon.jpg'));
    expect(ref.logoUrl).toBeUndefined();
    expect(ref.imageUrl).toBeUndefined();
    expect(bucket.uploads).toHaveLength(0);
    expect(ref.summary).toContain('This image is inspiration for the look — not an asset to place on the board.');
  });

  it('a photo of their MENU is content, not a hero: the menu leads, the picture is not placed', async () => {
    visionReply({
      summary: 'A chalkboard taqueria menu.',
      palette: ['#1f1a17'],
      role: 'photo',
      menu: { sections: [{ name: 'Tacos', items: [{ name: 'Al Pastor', price: '$3.25' }, { name: 'Carnitas', price: '$3.50' }] }] },
    });
    const bucket = memoryBucket();
    const controller = await makeController({ storage: bucket });
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(1600, 1067, 35), 'image/jpeg', 'menu.jpg'));
    expect(ref.imageUrl).toBeUndefined();
    expect(bucket.uploads).toHaveLength(0);
    expect(ref.menu.itemCount).toBe(2);
    expect(ref.summary.indexOf('A chalkboard taqueria menu.')).toBeGreaterThan(0); // the menu line leads
    expect(ref.summary).toContain('The picture itself is not placed on the board.');
  });
});

describe('reference/image — the reference survives the round trip', () => {
  it('passes ConciergeReferenceSchema (echoed back on every chat turn) with its provenance intact', async () => {
    visionReply({ summary: 'A bold wordmark.', palette: ['#f76422'], role: 'logo' });
    const controller = await makeController();
    const ref: any = await controller.conciergeReferenceImage(REQ, file(await wordmarkPng(1400, 392), 'image/png', 'logo.png'));
    const parsed: any = ConciergeReferenceSchema.parse(ref);
    expect(parsed.logoSource).toBe('upload');
    const chat: any = ConciergeChatSchema.parse({ messages: [{ role: 'user', content: 'hi' }], references: [ref] });
    expect(chat.references[0].logoUrl).toBe(ref.logoUrl);
  });

  it('a controller built without the vision service still answers — text only, through AiService, as before', async () => {
    const legacy = { kind: 'image', summary: 'A warm look.', palette: ['#aa3300'] };
    const ai = { analyzeDesignReferenceImage: jest.fn(async () => legacy) };
    const controller = await makeController({ withAltText: false, ai });
    const ref = await controller.conciergeReferenceImage(REQ, file(await photoJpeg(800, 600, 36), 'image/jpeg', 'look.jpg'));
    expect(ref).toBe(legacy);
    expect(ai.analyzeDesignReferenceImage).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
