/**
 * The vision read of an uploaded reference says what the image IS (2026-09-23):
 * the venue's LOGO, one of their PHOTOS, or a DESIGN to learn the look from —
 * in the SAME call that already returns the style summary and palette.
 *
 * Driven through the real AiAltTextService with only the provider's HTTP reply
 * stubbed (the OpenAI chat-completions shape the existing alt-text specs use),
 * so the object under test is exactly what the controller receives.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  AiAltTextService,
  designReferenceRole,
  parseDesignReferenceReply,
} from './ai-alt-text.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';

const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;

const auditRows: any[] = [];
const prismaMock: any = {
  client: {
    tenant: {
      findUnique: jest.fn(async () => ({ id: 'tenant-1', aiProvider: null, aiKeyEncrypted: null })),
      update: jest.fn(async () => ({})),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { auditRows.push(data); return data; }) },
  },
};

function openAiReply(content: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
  };
}

describe('AiAltTextService.analyzeDesignReference — role, from the same call', () => {
  let service: AiAltTextService;

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FREE_TIER_CAP;
    process.env.OPENAI_API_KEY = 'sk-test';
    auditRows.length = 0;
    fetchMock.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAltTextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: { publisher: null } },
      ],
    }).compile();
    service = module.get(AiAltTextService);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const analyze = () =>
    service.analyzeDesignReference({
      tenantId: 'tenant-1',
      imageBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
    });

  it('asks for the role in the JSON contract, once', async () => {
    fetchMock.mockResolvedValue(openAiReply({ summary: 'A bold orange wordmark.', palette: ['#f76422'], role: 'logo' }));
    await analyze();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const system = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body).messages);
    expect(system).toContain('\\"role\\":\\"logo | photo | design\\"');
    expect(system).toMatch(/"logo\\" when the image IS a brand's logo/);
    expect(system).toMatch(/"design\\" for anything else/);
  });

  it.each([
    ['logo', 'logo'],
    ['photo', 'photo'],
    ['design', 'design'],
    ['PHOTO', 'photo'],
  ] as const)('reply role %s → %s', async (said, want) => {
    fetchMock.mockResolvedValue(openAiReply({ summary: 'A warm taqueria look.', palette: ['#e2452a'], role: said }));
    const out = await analyze();
    expect(out!.role).toBe(want);
    const audit = auditRows.find((a) => a.action === 'AI_DESIGN_REFERENCE_ANALYZED');
    expect(JSON.parse(audit.details).role).toBe(want);
  });

  it('a reply with no role (an older model reply) reads as design — text only, as before', async () => {
    fetchMock.mockResolvedValue(openAiReply({ summary: 'Clean, modern cafe signage.', palette: [] }));
    expect((await analyze())!.role).toBe('design');
  });

  it('a menu photo is a design, whatever role the model gave it', async () => {
    fetchMock.mockResolvedValue(
      openAiReply({
        summary: 'A chalkboard taqueria menu.',
        palette: ['#1f1a17'],
        role: 'photo',
        menu: { sections: [{ name: 'Tacos', items: [{ name: 'Al Pastor', price: '$3.25' }] }] },
      }),
    );
    const out = await analyze();
    expect(out!.role).toBe('design');
    expect(out!.menu?.itemCount).toBe(1);
  });
});

describe('parseDesignReferenceReply / designReferenceRole — the safe reading', () => {
  it('unknown words, non-strings and prose replies are design', () => {
    expect(designReferenceRole('banner', false)).toBe('design');
    expect(designReferenceRole(7, false)).toBe('design');
    expect(designReferenceRole(undefined, false)).toBe('design');
    expect(designReferenceRole(' Logo ', false)).toBe('logo');
    expect(designReferenceRole('logo', true)).toBe('design');
    expect(parseDesignReferenceReply('A moody bar look, lots of neon.').role).toBe('design');
    expect(parseDesignReferenceReply('```json\n{"summary":"x","palette":[],"role":"photo"}\n```').role).toBe('photo');
  });
});
