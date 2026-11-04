const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium,webkit}=require('@playwright/test');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../../scripts/essentials-catalog.json')));
const root=process.env.TEMPLATE_TEST_URL||'http://127.0.0.1:8917';
const output=process.env.TEMPLATE_TEST_OUTPUT||path.resolve('test-results/essentials-bridge.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
const results=[];
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function send(page,data){await page.evaluate(d=>window.postMessage(d,'*'),{type:'educms-overrides',...data});await page.waitForTimeout(100);}
async function waitSource(page,expected){await page.waitForFunction(expected=>{const src=document.querySelector('[data-imgslot=\"hero.photo\"] img')?.getAttribute('src');return src&&new URL(src,location.href).href===new URL(expected,location.href).href;},expected);}
async function source(page){return page.locator('[data-imgslot="hero.photo"] img').first().getAttribute('src');}
(async()=>{for(const [engine,kind] of Object.entries({chromium,webkit})){
 const browser=await kind.launch();
 for(const [index,entry] of catalog.entries()){
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),r=>r.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+entry.url);await page.waitForFunction(()=>window.__essentialsReady===true);await page.evaluate(()=>document.fonts.ready);
  const title=page.locator('[data-field="hero.title"]'), hero=page.locator('[data-imgslot="hero.photo"]');
  await page.waitForFunction(()=>!!document.querySelector('[data-imgslot="hero.photo"] img')?.complete);
  const original={title:await title.textContent(),source:await source(page),accent:await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())};
  await page.evaluate(()=>{window.__clicks=[];addEventListener('message',e=>{if(e.data?.type==='educms-field-click')window.__clicks.push(e.data);});window.postMessage({type:'educms-edit-mode',on:true},'*');});
  await title.click();const heroBox=await hero.boundingBox();await hero.click({position:{x:heroBox.width*0.5,y:heroBox.height*0.3}});
  await page.waitForTimeout(100);
  const clicks=await page.evaluate(()=>window.__clicks.map(x=>[x.key,x.kind]));
  assert(clicks.some(x=>x[0]==='hero.title'&&x[1]==='text'));
  assert(clicks.some(x=>x[0]==='hero.photo'&&x[1]==='img'),JSON.stringify(clicks));
  const replacement='/templates/signage/hospitality/assets/hospitality-lobby-goldenhour-pool-v1.jpg';
  const payload={text:{'hero.title':'Welcome.\nMake yourself at home.','theme.accent':'#a7d5cb','theme.fDisplay':'Manrope','theme.scale':'1.08'},textStyles:{'hero.title':{fontSize:105,color:'#225566',fontFamily:'Arial'}},img:{'hero.photo':replacement}};
  await send(page,payload);
  assert.equal(await title.textContent(),payload.text['hero.title']);
  assert.equal(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),105);
  await waitSource(page,replacement);assert((await source(page)).includes(replacement));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#a7d5cb');
  // Saved URL state is the player/restore boundary; actual builder save is tested separately.
  await page.goto(root+entry.url+'?text='+encode(payload.text)+'&textStyles='+encode(payload.textStyles)+'&img='+encode(payload.img));
  await page.waitForFunction(()=>window.__essentialsReady&&document.querySelector('[data-imgslot="hero.photo"] img'));
  assert.equal(await title.textContent(),payload.text['hero.title']);
  assert.equal(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),105);
  // Menu/brand/media messages are partial; they must not clear saved copy,
  // images or text styling. Regression for Bar Hours losing a saved photo.
  await send(page,{menu:{items:[],configured:false},brand:{}});
  assert.equal(await title.textContent(),payload.text['hero.title']);
  assert.equal(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),105);
  await waitSource(page,replacement);
  await send(page,{img:payload.img,mediaStyles:{}});
  assert.equal(await title.textContent(),payload.text['hero.title']);
  assert.equal(await title.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),105);
  await send(page,{text:{},textStyles:{},img:{}});
  assert.equal(await title.textContent(),original.title);
  await waitSource(page,original.source);assert.equal(new URL(await source(page),root).href,new URL(original.source,root).href);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),original.accent);
  await send(page,{img:{'hero.photo':[]}});
  assert.equal(await hero.locator('img').count(),0);
  await send(page,{img:{}});await waitSource(page,original.source);assert.equal(new URL(await source(page),root).href,new URL(original.source,root).href);
  await page.setViewportSize({width:1080,height:1920});await page.waitForFunction(()=>document.querySelector('.stage').dataset.orient==='portrait');
  assert.equal(await page.locator('.stage').getAttribute('data-orient'),'portrait');
  await page.setViewportSize({width:1920,height:1080});await page.waitForFunction(()=>document.querySelector('.stage').dataset.orient==='landscape');
  assert.equal(await page.locator('.stage').getAttribute('data-orient'),'landscape');
  if(index===0){
   const img={'hero.photo':[original.source,replacement]};
   await send(page,{img,text:{'carousel.intervalSeconds':'2'}});
   await page.waitForFunction(()=>document.querySelector('[data-imgslot="hero.photo"] [data-carousel-index]')?.getAttribute('data-carousel-index')==='1',{},{timeout:5000});
   await send(page,{img,text:{'carousel.autoplay':'no','carousel.intervalSeconds':'2'}});
   const active=await hero.locator('[data-carousel-index]').getAttribute('data-carousel-index');await page.waitForTimeout(2400);
   assert.equal(await hero.locator('[data-carousel-index]').getAttribute('data-carousel-index'),active);
  }
  assert.deepEqual(errors,[]);results.push({engine,url:entry.url,clicks:true,text:true,font:true,theme:true,urlReload:true,mediaRestore:true,autoOrientation:true,carousel:index===0?'rotation and pause':'shared adapter',errors});
  console.log(engine,entry.url,'PASS');await page.close();
 }
 await browser.close();
}fs.writeFileSync(output,JSON.stringify(results,null,2));})().catch(e=>{fs.writeFileSync(output,JSON.stringify({completed:results,error:e.stack},null,2));console.error(e);process.exit(1)});
