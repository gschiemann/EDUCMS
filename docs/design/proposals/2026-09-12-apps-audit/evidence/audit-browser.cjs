// Functional browser harness: real AppConfigForm/registry, mocked preview/store/API.
// No CMS server, database, customer content, or provider playback is exercised.
const esbuild = require('./node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild');
const { chromium } = require('@playwright/test');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const mocks = {
  '@/components/widgets/WidgetRenderer': 'export const WidgetPreview=()=>null;',
  'next/dynamic': 'export default () => () => "Provider preview excluded from this functional harness";',
  '@/hooks/use-api': 'export const useTenant=()=>({data:{}}); export const useGenerateDesignerCandidates=()=>({isPending:false,mutateAsync:async x=>{window.auditEvents.push({ai:x});return {candidates:[{html:"<p>Mock generated board</p>"}]}}});',
  '@/hooks/use-tenant-copy': 'export const useTenantCopy=()=>({vertical:"education"});',
  '@/components/ai/AiGenerateButton': 'export const getAiStatusSource=async()=>"available";',
  '@/components/template-builder/useBuilderStore': 'export const useBuilderStore=fn=>fn({meta:{screenWidth:1920,screenHeight:1080},addZone:(type)=>{window.auditEvents.push({add:type});return "audit"},updateZone:(id,patch)=>window.auditEvents.push({update:patch}),select:()=>{}});',
};
(async () => {
  const bundle = await esbuild.build({entryPoints:['audit-browser-entry.tsx'],nodePaths:[require('node:path').resolve('apps/web/node_modules')],bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'audit-boundaries',setup(build){build.onResolve({filter:/.*/},args=> mocks[args.path] ? {path:args.path,namespace:'audit-mock'} : undefined);build.onLoad({filter:/.*/,namespace:'audit-mock'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
  const server = http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Isolated Apps form audit</title><style>body{font:16px system-ui;max-width:700px;margin:24px}svg{width:16px;height:16px}button,input,select{padding:8px;margin:4px}label{display:block}</style></head><body><h1>Functional harness — not the CMS</h1><div id="root"></div><script>window.auditEvents=[]</script><script src="/bundle.js"></script></body></html>');}});
  let browser;
  const results={scope:'Real AppConfigForm + registry in Chromium. Preview, canvas store, tenant and AI APIs mocked. No provider or deployed app certification.',checks:[],errors:[]};
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    page.on('pageerror',e=>results.errors.push(e.message));
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base+'/?app=web-url');
    await page.getByLabel('Web page link').fill('not a valid url');
    await page.getByRole('button',{name:'Add to canvas',exact:true}).click();
    let events=await page.evaluate(()=>window.auditEvents);
    assert(events.some(e=>e.update?.defaultConfig?.url==='https://not a valid url'));
    results.checks.push({name:'Invalid nonempty URL is accepted in real Chromium',reproduced:true,events});
    await page.goto(base+'/?app=calendar');
    await page.getByLabel('Your Google Calendar link').fill('https://calendar.google.com/calendar/ical/%ZZ/public/basic.ics');
    await page.getByRole('button',{name:'Add to canvas',exact:true}).click();
    events=await page.evaluate(()=>window.auditEvents);
    assert(events.some(e=>e.update && Object.keys(e.update.defaultConfig).length===0));
    results.checks.push({name:'Conversion failure still adds empty WEBPAGE',reproduced:true,events});
    await page.goto(base+'/?app=youtube');
    await page.getByLabel('YouTube link').fill('https://youtu.be/abc123XYZ12');
    await page.getByRole('button',{name:'Design one with AI',exact:true}).click();
    await page.waitForFunction(()=>window.auditEvents.some(e=>e.update));
    events=await page.evaluate(()=>window.auditEvents);
    assert(!JSON.stringify(events).includes('abc123XYZ12'));
    results.checks.push({name:'AI design path omits source and adds mock HTML board',reproduced:true,events});
    await page.goto(base+'/?app=instagram');
    assert(await page.getByRole('button',{name:'Add to canvas',exact:true}).isDisabled());
    results.checks.push({name:'Coming-soon add button is disabled',passed:true});
    assert.equal(results.errors.length,0);
    console.log(JSON.stringify(results,null,2));
    await fs.writeFile('audit-browser-results.json',JSON.stringify(results,null,2));
  } finally { if(browser) await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
