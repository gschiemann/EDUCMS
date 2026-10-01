const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('@playwright/test');
const root=path.resolve(__dirname,'../../../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/templates/homebuilder-install-manifest.json'),'utf8'));
let base=process.env.HOMEBUILDER_TEST_BASE;
let server;
const provenancePath=path.join(root,'apps/web/public/templates/_thumbs/poster-manifest.json');
const provenance=JSON.parse(fs.readFileSync(provenancePath,'utf8'));
const output=process.env.HOMEBUILDER_TEST_OUTPUT || '/tmp/homebuilder-cms-proof';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 if(!base){
  const http=require('node:http');
  const publicRoot=path.join(root,'apps/web/public');
  server=http.createServer((req,res)=>{
   const rel=new URL(req.url,'http://localhost').pathname;
   const file=path.resolve(publicRoot,'.'+decodeURIComponent(rel));
   if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
   const mime={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 }
 try {
 const results=[];
 for(const [name,engine] of Object.entries({chromium,webkit})) {
  const browser=await engine.launch();
  for(const record of manifest) {
   const portrait=record.orientation==='PORTRAIT';
   const page=await browser.newPage({viewport:portrait?{width:720,height:1280}:{width:1280,height:720}});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.setContent(`<iframe title="Board" sandbox="allow-scripts" src="${base}${record.url}?freeze=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`);
   const frame=page.frames().find(f=>f!==page.mainFrame());
   await frame.waitForSelector('[data-native-image-carousel]');
   await frame.evaluate(()=>document.fonts.ready);
   // Let the board's reveal and gallery freeze settle before capture.
   await frame.waitForFunction(() => Array.from(document.querySelectorAll('.line-reveal')).every(e => Number(getComputedStyle(e).opacity) === 1));
   await page.waitForTimeout(180);
   const proof=await frame.evaluate(()=>({
    origin:location.origin,portrait:document.querySelector('.stage').classList.contains('portrait'),
    fields:document.querySelectorAll('[data-field]').length,
    images:Array.from(document.querySelectorAll('[data-native-image-carousel] img')).every(i=>i.complete&&i.naturalWidth>0),
    clipped:Array.from(document.querySelectorAll('.stage [data-fit]')).filter(e=>e.offsetWidth&&e.offsetHeight&&e.scrollWidth>e.clientWidth+3).map(e=>e.dataset.field),
    native:document.querySelectorAll('[data-native-image-carousel]').length,
    logosContained:Array.from(document.querySelectorAll('[data-imgslot*="logo"] img')).every(i=>getComputedStyle(i).objectFit==='contain'),
   }));
   assert.equal(proof.logosContained,true,record.id+' logo fit');assert.equal(proof.portrait,portrait,record.id);assert.equal(proof.images,true,record.id+' image load');assert.equal(proof.clipped.length,0,record.id+' clipping '+proof.clipped);assert.equal(errors.length,0,errors.join('\n'));
   const dest=path.join(root,'apps/web/public/templates/_thumbs',record.url.slice('/templates/'.length).replace(/\.html$/,'.png'));
   if(name==='chromium'){fs.mkdirSync(path.dirname(dest),{recursive:true});await page.screenshot({path:dest});provenance[record.url.slice('/templates/'.length).replace(/\.html$/,'')]=record.sha256.slice(0,16);}
   if(record.url.endsWith('04-home-plan.html')||record.url.endsWith('01-welcome-cinematic.html'))await page.screenshot({path:path.join(output,name+'-'+record.id+'.png')});
   results.push({engine:name,id:record.id,...proof});await page.close();
  }
  // Real seven-second timing, single-image mode, query overrides and containment.
  for(const collection of ['standard','brookfield']) {
   const record=manifest.find(r=>r.collection===collection && r.url.endsWith('04-home-plan.html')&&!r.url.includes('/portrait/'));
   const page=await browser.newPage({viewport:{width:1280,height:720}});
   await page.goto(base+record.url);await page.waitForSelector('[data-native-image-carousel]');
   const selector='[data-imgslot="home.plan"] [data-native-image-carousel]';
   assert.equal(await page.locator(selector).getAttribute('data-carousel-index'),'0');
   await page.waitForTimeout(6200);assert.equal(await page.locator(selector).getAttribute('data-carousel-index'),'0');
   await page.waitForTimeout(1300);assert.equal(await page.locator(selector).getAttribute('data-carousel-index'),'1');
   assert.equal(await page.locator(selector+' img').last().evaluate(e=>getComputedStyle(e).objectFit),'contain');
   await page.waitForTimeout(300);
   assert.equal(await page.locator(selector+' img').first().evaluate(e=>getComputedStyle(e).opacity),'0', 'Outgoing transparent floor plan must disappear');
   const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
   await page.goto(base+record.url+'?text='+enc({'media.home.plan.mode':'single','carousel.intervalSeconds':'2'}));await page.waitForSelector(selector);await page.waitForTimeout(4500);
   assert.equal(await page.locator(selector).getAttribute('data-carousel-index'),'0');
   results.push({engine:name,collection,timing:'7 seconds',single:'stable',floorFit:'contain'});await page.close();
  }
  await browser.close();
 }
 fs.writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n');
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({pass:true,cases:results.length,output}));
} finally { if(server) await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exit(1)});
