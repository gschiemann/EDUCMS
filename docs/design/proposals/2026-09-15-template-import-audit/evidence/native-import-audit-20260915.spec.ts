import {TemplatesController} from './templates.controller';
jest.mock('../prisma/prisma.service',()=>({PrismaService:class{}}));
jest.mock('../ai/ai.service',()=>({AiService:class{},sanitizeTouchTemplate:jest.fn()}));
jest.mock('../branding/branding-scraper.service',()=>({BrandingScraperService:class{},normalizeWebUrl:jest.fn()}));
jest.mock('../storage/supabase-storage.service',()=>({SupabaseStorageService:class{}}));
jest.mock('../auth/jwt-auth.guard',()=>({JwtAuthGuard:class{}}));
jest.mock('../auth/rbac.guard',()=>({RbacGuard:class{}}));

describe('Native template envelope audit',()=>{
 const req={user:{id:'synthetic-user',tenantId:'synthetic-tenant',role:'SCHOOL_ADMIN'}};
 function harness(){
  const source={id:'source',tenantId:'synthetic-tenant',name:'Two scenes',isSystem:false,isTouchEnabled:true,idleResetMs:30000,screenWidth:1920,screenHeight:1080,scenes:[{id:'scene-a',name:'A'},{id:'scene-b',name:'B'}],zones:[{id:'z-a',name:'Button',widgetType:'TEXT',x:0,y:0,width:50,height:50,zIndex:1,sortOrder:0,sceneId:'scene-a',locked:true,touchAction:{type:'scene',sceneId:'scene-b'},defaultConfig:JSON.stringify({content:'Go',assetUrl:'https://example.test/source-account.png'})}]};
  const prisma:any={client:{template:{findFirst:jest.fn(async()=>source)}}};
  return {prisma,controller:new TemplatesController(prisma,{} as any,{} as any,{} as any)};
 }
 it('export queries caller tenant or system preset, not arbitrary tenant',async()=>{
  const h=harness(); await h.controller.exportTemplate(req,'source');
  expect(h.prisma.client.template.findFirst.mock.calls[0][0].where).toEqual({id:'source',OR:[{tenantId:'synthetic-tenant'},{isSystem:true}]});
 });
 it('export strips source identity fields (positive control)',async()=>{
  const h=harness();const out=await h.controller.exportTemplate(req,'source');
  expect(out.template.id).toBeUndefined();expect(out.template.tenantId).toBeUndefined();expect(out.template.isSystem).toBeUndefined();
 });
 it('export omits scenes, touch mode, idle timer, zone locks and actions',async()=>{
  const out=await harness().controller.exportTemplate(req,'source');
  for(const k of ['scenes','isTouchEnabled','idleResetMs']) expect(out.template[k]).toBeUndefined();
  for(const k of ['sceneId','locked','touchAction']) expect(out.template.zones[0][k]).toBeUndefined();
 });
 it('export retains original media URL rather than bundling/remapping media',async()=>{
  const out=await harness().controller.exportTemplate(req,'source');
  expect(out.template.zones[0].defaultConfig.assetUrl).toBe('https://example.test/source-account.png');
 });
 it('rejects foreign envelope format',async()=>{
  await expect(harness().controller.importTemplate(req,{_format:'other',_version:1})).rejects.toMatchObject({status:400});
 });
 it('rejects unsupported envelope version',async()=>{
  await expect(harness().controller.importTemplate(req,{_format:'educms.template',_version:2})).rejects.toMatchObject({status:400});
 });
});
