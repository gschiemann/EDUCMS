const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,webkit}=require('../apps/web/node_modules/@playwright/test');
let base=process.env.JLL_REVIEW_URL;
const publicRoot=path.resolve(__dirname,'../apps/web/public');
const server=http.createServer((req,res)=>{
 const file=path.resolve(publicRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 const type={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res);
});
const output=process.env.JLL_TOUCH_PROOF||'/tmp/jll-touch-proof';fs.mkdirSync(output,{recursive:true});
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
async function send(page,data){await page.evaluate(d=>document.querySelector('iframe').contentWindow.postMessage(d,'*'),data);await page.waitForTimeout(100);}
async function mount(browser,url,portrait){
  const page=await browser.newPage({viewport:portrait?{width:1080,height:1920}:{width:1920,height:1080}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>body{margin:0}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style><iframe title="Property experience" sandbox="allow-scripts" src="${url}"></iframe><script>window.messages=[];addEventListener('message',e=>window.messages.push(e.data))</script>`);
  const frame=page.frames().find(f=>f!==page.mainFrame());await frame.waitForSelector('[data-native-image-carousel]');await frame.evaluate(()=>document.fonts.ready);
  try{await frame.waitForFunction(()=>[...document.querySelectorAll('[data-native-image-carousel] img')].every(i=>i.complete&&i.naturalWidth>0),{},{timeout:10000});}
  catch(e){throw Error(url+' media failed '+JSON.stringify(await frame.locator('[data-native-image-carousel] img').evaluateAll(es=>es.filter(i=>!i.complete||!i.naturalWidth).map(i=>({src:i.src,complete:i.complete})))));}
  return {page,frame,errors};
}
async function layout(frame){return frame.evaluate(()=>{
  const es=[...document.querySelectorAll('.stage [data-field]')].filter(e=>e.offsetWidth&&e.offsetHeight),errors=[];
  es.forEach(e=>{const r=e.getBoundingClientRect();if(r.right>innerWidth+1||r.bottom>innerHeight-10||r.left<0||e.scrollWidth>e.clientWidth+2||parseFloat(getComputedStyle(e).fontSize)<96)errors.push(e.dataset.field+' bounds/type');});
  for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++){const a=es[i].getBoundingClientRect(),b=es[j].getBoundingClientRect();if(a.left<b.right-4&&a.right>b.left+4&&a.top<b.bottom-4&&a.bottom>b.top+4)errors.push(es[i].dataset.field+' overlaps '+es[j].dataset.field);}
  document.querySelectorAll('.stage button').forEach(e=>{if(!e.offsetWidth||!e.offsetHeight)return;const r=e.getBoundingClientRect();if(Math.min(r.width,r.height)*2/3<44)errors.push('Small touch target '+e.textContent);});
  return errors;
});}
async function main(){
 if(!base){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;}
 const results=[];
 for(const [engineName,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch();
  try{
   for(const brand of ['jll','generic'])for(const orientation of ['landscape','portrait'])for(const variant of ['a','b','c']){
    const id=`${engineName}-${brand}-${variant}-${orientation}`;
    const url=`${base}/templates/custom/jll-touch-experiences/${brand}-${variant}.html?orientation=${orientation}&text=${encode({'carousel.autoplay':'no'})}`;
    const {page,frame,errors}=await mount(browser,url,orientation==='portrait');
    assert.equal(await frame.evaluate(()=>self.origin),'null');
    for(const section of ['home','amenities','plans','location','details','contact','gallery']){
     await frame.locator('.app-nav [data-go="'+section+'"]').click();
     assert.equal(await frame.locator('[data-page="'+section+'"]').isVisible(),true);
     await frame.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.target?.classList.contains('experience-page')).map(a=>a.finished.catch(()=>{}))));
     const proof=await layout(frame);
     if(proof.length||brand==='jll'&&(variant==='a'||section==='home'))await page.screenshot({animations:'disabled',path:path.join(output,id+'-'+section+'.png')});
     assert.deepEqual(proof,[],id+' '+section);
     results.push({id:id+'-'+section,pass:true});
    }
    await frame.locator('[data-gallery-step="1"]').click();assert.equal(await frame.locator('[data-gallery-panel="1"]').evaluate(e=>e.hidden),false);
    await frame.locator('[data-gallery="2"]').click();await frame.locator('[data-gallery-step="1"]').click();assert.equal(await frame.locator('[data-gallery-panel="0"]').evaluate(e=>e.hidden),false);
    await frame.locator('.app-nav [data-go="amenities"]').click();for(const n of [1,2]){await frame.locator('[data-amenity="'+n+'"]').click();assert.equal(await frame.locator('[data-amenity-panel="'+n+'"]').evaluate(e=>e.hidden),false);assert.deepEqual(await layout(frame),[],id+' amenity '+n);}
    await frame.locator('.app-nav [data-go="plans"]').click();
    for(const n of [0,1,2,3,4,5,6,7]){await frame.locator('[data-floor="'+n+'"]').click();assert.equal(await frame.locator('[data-floor-panel="'+n+'"]').isVisible(),true);assert.deepEqual(await layout(frame),[],id+' direct floor '+n);}
    await frame.locator('[data-floor="2"]').click();
    await frame.locator('.app-nav [data-go="gallery"]').click();
    await frame.locator('[data-back]').click();
    assert.equal(await frame.locator('[data-page="plans"]').isVisible(),true,id+' Back retains page');
    assert.equal(await frame.locator('[data-floor="2"]').getAttribute('aria-pressed'),'true',id+' Back retains floor');
    await frame.locator('[data-zoom="in"]').click();assert.equal(await frame.locator('[data-field="plans.zoom"]').textContent(),'150%');
    assert.equal(await frame.locator('.plan-window').evaluate(e=>e.scrollWidth>e.clientWidth),true);
    const box=await frame.locator('.plan-window').boundingBox();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:4});await page.mouse.up();assert.equal(await frame.locator('.plan-window').evaluate(e=>e.scrollLeft>0&&e.scrollTop>0),true,id+' pan');
    await frame.locator('[data-zoom="fit"]').click();assert.equal(await frame.locator('[data-field="plans.zoom"]').textContent(),'100%');
    assert.equal(await frame.locator('[data-imgslot="plan.2"] img').first().evaluate(e=>getComputedStyle(e).objectFit),'contain');
    await send(page,{type:'educms-overrides',text:{'tour.startPage':'amenities','amenity.2.title':'Your rooftop\nworkspace.','theme.brand':'#145653','contact.url':'https://example.com/approved-property'},textStyles:{'amenity.2.title':{bold:true,offsetX:12,offsetY:8}}});
    await frame.waitForFunction(()=>!document.querySelector('[data-page="amenities"]').hidden);
    assert.equal(await frame.locator('[data-page="amenities"]').isVisible(),true,id+' initial-page override');assert.equal(await frame.locator('[data-field="amenity.2.title"]').textContent(),'Your rooftop\nworkspace.');
    assert.equal(await frame.locator('[data-field="amenity.2.title"]').evaluate(e=>e.style.transform.includes('12px')&&e.style.transform.includes('8px')),true);
    await send(page,{type:'educms-layout-request'});assert.equal(await page.evaluate(()=>window.messages.some(m=>m.type==='educms-layout-ready'&&m.keys.includes('amenity.2.title'))),true);
    await send(page,{type:'educms-edit-mode',on:true});await frame.locator('[data-field="amenity.2.title"]').click();await page.waitForFunction(()=>window.messages.some(m=>m.type==='educms-field-click'&&m.key==='amenity.2.title'));
    await frame.locator('.app-nav [data-go="plans"]').click();assert.equal(await frame.locator('[data-page="amenities"]').isVisible(),true,id+' editor prevents navigation');
    await send(page,{type:'educms-edit-mode',on:false});
    await frame.locator('.app-nav [data-go="contact"]').click();
    assert.equal(await frame.locator('[data-page="contact"]').isVisible(),true,id+' navigation resumes after editing');
    const fresh={page,frame,errors};
    await fresh.frame.locator('.app-nav [data-go="contact"]').click();
    await send(fresh.page,{type:'educms-overrides',text:{'contact.url':'https://example.com/approved-property','tour.idleSeconds':'30'}});
    assert.equal(await fresh.frame.locator('[data-qr]').getAttribute('data-destination'),'https://example.com/approved-property');
    await send(fresh.page,{type:'educms-overrides',text:{'contact.url':'javascript:alert(1)'}});assert.equal(await fresh.frame.locator('[data-qr]').getAttribute('data-error'),'invalid-url');
    await fresh.frame.evaluate(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+31000;});await fresh.frame.waitForFunction(()=>!document.querySelector('[data-page="home"]').hidden);
    assert.equal(await fresh.frame.locator('[data-floor="0"]').getAttribute('aria-pressed'),'true');assert.equal(await fresh.frame.locator('[data-gallery="0"]').getAttribute('aria-pressed'),'true');
    assert.deepEqual(errors,[],id+' browser errors');assert.deepEqual(fresh.errors,[],id+' reset errors');
    results.push({id:id+'-interaction-and-editor',pass:true});await fresh.page.close();
   }
   // Prove motion uses the existing native carousel and real video playback.
   for(const folder of ['jll-overview-directions','jll-touch-experiences'])for(const variant of ['a','b','c']){
    const url=`${base}/templates/custom/${folder}/jll-${variant}.html?text=${encode({'carousel.intervalSeconds':'1'})}`;
    const {page,frame}=await mount(browser,url,false);
    await frame.waitForFunction(()=>Number(document.querySelector('[data-imgslot="property.hero"] [data-carousel-index]')?.dataset.carouselIndex)>0);
    const fixture=fs.readFileSync('/tmp/jll-video-fixture.mp4');
    await page.route('**/test-property-film.mp4',route=>route.fulfill({status:200,headers:{'Content-Type':'video/mp4','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes'},body:fixture}));
    await send(page,{type:'educms-overrides',video:{'property.film':base+'/test-property-film.mp4'}});
    await frame.waitForFunction(()=>{const v=document.querySelector('[data-videoslot="property.film"]');return v.readyState>=2&&v.currentTime>0&&v.classList.contains('video-ready');});
    assert.equal(await frame.locator('video').evaluate(v=>v.muted&&v.loop&&v.playsInline),true);
    if(folder==='jll-touch-experiences'){await frame.locator('.app-nav [data-go="plans"]').click();assert.equal(await frame.locator('video').evaluate(v=>v.paused),true);await frame.locator('[data-restart]').click();}
    await send(page,{type:'educms-overrides',video:{'property.film':''}});assert.equal(await frame.locator('video').evaluate(v=>v.classList.contains('video-ready')),false);
    await send(page,{type:'educms-overrides',video:{'property.film':base+'/missing-film.mp4'}});await frame.waitForFunction(()=>!document.querySelector('video').classList.contains('video-ready'));
    assert.equal(await frame.locator('[data-imgslot="property.hero"] img').last().evaluate(i=>i.complete&&i.naturalWidth>0),true);
    results.push({id:engineName+'-'+folder+'-'+variant+'-carousel-video-fallback',pass:true});await page.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({pass:true,cases:results.length,output}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
