/** Audit reproductions, not product acceptance tests: PASS means the named
 * behavior exists. Real PPTX parser and controller; storage/DB/auth mocked.
 * No network, credentials, real school data, or production writes. */
import JSZip from 'jszip';
import { parsePptx } from './parsers/pptx-parser';
import { buildTemplates } from './parsers/import-builder';
import { ImportsController } from './imports.controller';
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('../storage/supabase-storage.service', () => ({ SupabaseStorageService: class {} }));
jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../auth/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@cms/database', () => ({ AppRole: Object.fromEntries(['SUPER_ADMIN','DISTRICT_ADMIN','SCHOOL_ADMIN','CONTRIBUTOR'].map(x => [x,x])) }));
jest.mock('./parsers/pdf-parser', () => ({ parsePdf: jest.fn() }));

const text = (content = 'Hello', x = 0) => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="4400"/><a:t>${content}</a:t></a:r></a:p></p:txBody></p:sp>`;
const picture = '<p:pic><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm></p:spPr></p:pic>';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function deck(shapes: string[]) {
  const z = new JSZip();
  z.file('ppt/presentation.xml', '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
  for (let i = 0; i < shapes.length; i++) {
    z.file(`ppt/slides/slide${i+1}.xml`, `<p:sld><p:cSld><p:spTree>${shapes[i]}</p:spTree></p:cSld></p:sld>`);
    z.file(`ppt/slides/_rels/slide${i+1}.xml.rels`, '<Relationships><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image.png"/></Relationships>');
  }
  z.file('ppt/media/image.png', png);
  return z.generateAsync({type:'nodebuffer'});
}
const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const upload = (buffer: Buffer, originalname = 'synthetic.pptx', mimetype = mime) => ({ buffer, size: buffer.length, originalname, mimetype } as any);
function harness(role = 'SCHOOL_ADMIN') {
  let id = 0;
  const row = jest.fn(async ({data}: any) => ({...data,id:`row-${++id}`}));
  const db: any = {
    ensurePlaylistMetadataColumns: jest.fn(async () => {}),
    client: {
      asset: {create: jest.fn(row)},
      playlist: {findMany: jest.fn(async () => []), create: jest.fn(row)},
      playlistItem: {create: jest.fn(row)},
      template: {findMany: jest.fn(async () => []), create: jest.fn(row)},
      auditLog: {create: jest.fn(row)},
    },
  };
  const storage: any = { toSafeBuffer: (b: Buffer) => b,
    upload: jest.fn(async (path: string) => `https://storage.example/object/public/assets/${path}`) };
  return {db, storage, controller: new ImportsController(db, storage), req: {user:{id:'synthetic-actor',tenantId:'synthetic-tenant',role}}};
}
describe('Audit: positive controls', () => {
  it('simple text plus supported picture survives parser and builder', async () => {
    const doc = await parsePptx(await deck([text(),picture]));
    expect(buildTemplates(doc,{resolveMedia:()=> 'https://example.test/image.png'})).toHaveLength(2);
  });
  it('controller persists source tenant on assets, playlist and templates', async () => {
    const h = harness();
    await h.controller.importDesign(h.req,upload(await deck([text()])),{targetType:'template'});
    for (const model of ['asset','playlist','template']) expect(h.db.client[model].create.mock.calls[0][0].data.tenantId).toBe('synthetic-tenant');
  });
});
describe('Audit: reproducible parser limitations (green = reproduced)', () => {
  it('picture behind text in source becomes above text in import', async () => {
    const doc = await parsePptx(await deck([picture + text()]));
    expect(doc.pages[0].zones.map(z=>z.widgetType)).toEqual(['TEXT','IMAGE']);
    expect(doc.pages[0].zones[1].zIndex).toBeGreaterThan(doc.pages[0].zones[0].zIndex);
  });
  it('group origin at 50% is ignored for its child at local x=0', async () => {
    const grp = `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="6096000" y="0"/><a:ext cx="3048000" cy="1714500"/><a:chOff x="0" y="0"/><a:chExt cx="3048000" cy="1714500"/></a:xfrm></p:grpSpPr>${text()}</p:grpSp>`;
    expect((await parsePptx(await deck([grp]))).pages[0].zones[0].x).toBe(0);
  });
  it('text placeholder with inherited geometry is omitted', async () => {
    const inherited = '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>';
    expect((await parsePptx(await deck([inherited]))).pages[0].zones).toHaveLength(0);
  });
  it('61 source slides produce only 60 parsed pages without a warning field', async () => {
    const doc = await parsePptx(await deck(Array.from({length:61}, (_,i)=>text(`Slide ${i+1}`))));
    expect(doc.pages).toHaveLength(60);
    expect((doc as any).warnings).toBeUndefined();
  });
  it('81 text boxes produce only 80 zones', async () => {
    const doc = await parsePptx(await deck([Array.from({length:81}, (_,i)=>text(`Box ${i+1}`)).join('')]));
    expect(doc.pages[0].zones).toHaveLength(80);
  });
  it('a missing image removes its entire image-only slide', async () => {
    const doc = await parsePptx(await deck([text(),picture]));
    const result = buildTemplates(doc,{resolveMedia:()=>null});
    expect(result.map(p=>p.label)).toEqual(['Slide 1']);
  });
  it('numeric-looking text loses leading zeros', async () => {
    const doc = await parsePptx(await deck([text('00123')]));
    expect(doc.pages[0].zones[0].defaultConfig.content).toBe('123');
  });
});
describe('Audit: controller failure and approval behavior (green = reproduced)', () => {
  let warn: jest.SpyInstance;
  beforeEach(()=> {warn=jest.spyOn(console,'warn').mockImplementation(()=>{});});
  afterEach(()=>warn.mockRestore());
  it('legacy PPT parse failure reports success with IMAGE pointing at .ppt', async () => {
    const h = harness();
    const res = await h.controller.importDesign(h.req, upload(Buffer.from('synthetic non-ZIP legacy input'),'legacy.ppt','application/vnd.ms-powerpoint'),{targetType:'template'});
    expect(res.ok).toBe(true);
    const zone = h.db.client.template.create.mock.calls[0][0].data.zones.create[0];
    expect(zone.widgetType).toBe('IMAGE');
    expect(JSON.parse(zone.defaultConfig).assetUrl).toMatch(/\.ppt$/);
  });
  it('template-only action still creates a raw-original playlist', async () => {
    const h=harness();
    await h.controller.importDesign(h.req,upload(await deck([text()])),{targetType:'template'});
    expect(h.db.client.playlistItem.create).toHaveBeenCalledTimes(1);
    expect(h.db.client.playlistItem.create.mock.calls[0][0].data.assetId).toBe('row-1');
  });
  it('playlist action creates no converted templates for PPTX', async () => {
    const h=harness();
    const res=await h.controller.importDesign(h.req,upload(await deck([text(),picture])),{targetType:'playlist'});
    expect(res.templates).toEqual([]);
    expect(h.db.client.playlistItem.create).toHaveBeenCalledTimes(1);
  });
  it('contributor source is pending but extracted image is approved and template active', async () => {
    const h=harness('CONTRIBUTOR');
    await h.controller.importDesign(h.req,upload(await deck([picture])),{targetType:'template'});
    expect(h.db.client.asset.create.mock.calls.map((c:any)=>c[0].data.status)).toEqual(['PENDING_APPROVAL','APPROVED']);
    expect(h.db.client.template.create.mock.calls[0][0].data.status).toBe('ACTIVE');
  });
  it('failed audit write still resolves success', async () => {
    const h=harness(); h.db.client.auditLog.create.mockRejectedValue(new Error('injected audit outage'));
    const res=await h.controller.importDesign(h.req,upload(png,'image.png','image/png'),{targetType:'template'});
    expect(res.ok).toBe(true); expect(warn).toHaveBeenCalled();
  });
  it('second template failure leaves first created plus playlist and original', async () => {
    const h=harness();
    h.db.client.template.create.mockResolvedValueOnce({id:'first',name:'First'}).mockRejectedValueOnce(new Error('injected DB failure'));
    await expect(h.controller.importDesign(h.req,upload(await deck([text(),text('Second')])),{targetType:'template'})).rejects.toThrow('injected DB failure');
    expect(h.db.client.template.create).toHaveBeenCalledTimes(2);
    expect(h.db.client.playlistItem.create).toHaveBeenCalledTimes(1);
    expect(h.db.client.auditLog.create).not.toHaveBeenCalled();
  });
  it('image upload is always placed on a 1920x1080 landscape canvas', async () => {
    const h=harness();
    await h.controller.importDesign(h.req,upload(png,'square.png','image/png'),{targetType:'template'});
    expect(h.db.client.template.create.mock.calls[0][0].data).toMatchObject({screenWidth:1920,screenHeight:1080,orientation:'LANDSCAPE'});
  });
  it('generic PPTX MIME reaches storage unchanged', async () => {
    const h=harness();
    await h.controller.importDesign(h.req,upload(await deck([text()]),'generic.pptx','application/octet-stream'),{targetType:'template'});
    expect(h.storage.upload.mock.calls[0][2]).toBe('application/octet-stream');
  });
  it('failed extracted-media upload silently omits image-only second slide', async () => {
    const h=harness(); h.storage.upload.mockResolvedValueOnce('https://example.test/source.pptx').mockRejectedValueOnce(new Error('injected media outage'));
    const res=await h.controller.importDesign(h.req,upload(await deck([text(),picture])),{targetType:'template'});
    expect(res.templates).toHaveLength(1);
    expect(res.message).toContain('fully editable');
    expect((res as any).warnings).toBeUndefined();
  });
});
