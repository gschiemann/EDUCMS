// Native directory media must agree with the shared Replace/Undo painter.
// Run from apps/web, or set DIRECTORY_PHOTO_ORIGIN to verify deployed assets.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium,webkit}=require('@playwright/test');
const root=path.resolve(__dirname,'../../public'),dir='/templates/signage/corporate/directory/';
const picture=color=>'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="${color}"/></svg>`).toString('base64');
const original=picture('green'),picked=picture('blue'),shared=picture('red');
const base64=value=>Buffer.from(JSON.stringify(value)).toString('base64');
(async()=>{let server,origin=process.env.DIRECTORY_PHOTO_ORIGIN;const results=[];
try{
 if(!origin){server=http.createServer({maxHeaderSize:65536},(req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const bytes=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;}
 for(const[name,type]of[['chromium',chromium],['webkit',webkit]]){const browser=await type.launch();try{
 for(const file of fs.readdirSync(root+dir).filter(f=>f.endsWith('.html'))){const p=await browser.newPage({viewport:file.includes('portrait')?{width:2160,height:3840}:{width:3840,height:2160}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+dir+file);await p.waitForFunction(()=>window.ARCPlayer?.getState().ready);assert.equal(await p.locator('.display-controls').count(),0);
 const doc=JSON.parse(await p.locator('#arc-directory-document').textContent());doc.dataset={...doc.dataset,image:original,sourceStatus:'partial',expectedRows:66,tenants:doc.dataset.tenants.slice(0,6)};doc.theme={};
 async function send(value,img,expected){await p.evaluate(({value,img})=>postMessage({type:'educms-overrides',text:{'directory.payload':JSON.stringify(value)},img,brand:{}},'*'),{value,img});await p.waitForFunction(src=>document.querySelector('.art-direction-image').getAttribute('src')===src,expected);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await p.locator('.art-direction-image').getAttribute('src'),expected);}
 await p.evaluate(()=>postMessage({type:'educms-edit-mode',on:true},'*'));
 await send(doc,{},original);assert(await p.locator('.art-direction-media').evaluate(n=>n.classList.contains('reference-artwork')));
 const edited={...doc,theme:{image:picked}};await send(edited,{},picked);assert(!await p.locator('.art-direction-media').evaluate(n=>n.classList.contains('reference-artwork')));
 await send(doc,{'property.hero':shared},shared);await send(edited,{},picked);await send({...edited,dataset:{...doc.dataset,title:'Edited after replacing photo'}},{},picked);
 await send(doc,{},original);assert(await p.locator('.art-direction-media').evaluate(n=>n.classList.contains('reference-artwork')));assert.equal(await p.locator('.art-direction-caption').textContent(),'Supplied building artwork');
 for(const [saved,img,expected]of [[doc,{'property.hero':shared},shared],[edited,{},picked]]){
  await p.goto(origin+dir+file+'?text='+encodeURIComponent(base64({'directory.payload':JSON.stringify(saved)}))+'&img='+encodeURIComponent(base64(img)));await p.waitForFunction(src=>window.ARCPlayer?.getState().ready&&document.querySelector('.art-direction-image').getAttribute('src')===src,expected);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await p.locator('.art-direction-image').getAttribute('src'),expected);
 }
 if(file.startsWith('care-atlas-'))for(const mode of ['crossfade','flip','slide','slide-right','vertical-scroll','vertical-scroll-down','continuous-scroll','continuous-scroll-down']){
  await p.goto(origin+dir+file);await p.waitForFunction(()=>window.ARCPlayer?.getState().ready);
  const frames=await p.evaluate(mode=>{ARCPlayer.setConfig({displayMode:'pages',locationsPerPage:3,motionSpeed:'fast',transitionMode:mode,pageDurationMs:3000,autoplay:mode.startsWith('continuous-scroll'),scrollStartHoldMs:0});
   if(!mode.startsWith('continuous-scroll'))ARCPlayer.goToPage(1);
   return {mode:ARCPlayer.getState().config.transitionMode,pages:ARCPlayer.getState().pages,animations:document.getAnimations().filter(a=>a.effect?.target?.classList.contains(mode.startsWith('continuous-scroll')?'pages-host':'directory-page')).map(a=>({page:a.effect.target.dataset.page,duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay,frames:a.effect.getKeyframes().map(f=>({transform:f.transform,opacity:f.opacity}))}))};
  },mode);assert.equal(frames.mode,mode);assert(frames.animations.length);
  const out=frames.animations.find(a=>a.page==='0')||frames.animations[0],end=out.frames.at(-1);
  if(mode==='slide')assert.equal(end.transform,'translateX(-100%)');
  if(mode==='slide-right')assert.equal(end.transform,'translateX(100%)');
  if(mode==='vertical-scroll')assert.equal(end.transform,'translateY(-100%)');
  if(mode==='vertical-scroll-down')assert.equal(end.transform,'translateY(100%)');
  if(mode.startsWith('continuous-scroll')){assert.equal(frames.animations[0].duration,frames.pages*3000);assert.equal(frames.animations[0].delay,0);const distance=Number(/translateY\((-?[\d.]+)px\)/.exec(end.transform)?.[1]);assert(mode.endsWith('-down')?distance>0:distance<0);await p.waitForTimeout(80);assert((await p.evaluate(()=>ARCPlayer.getState().continuousTime))>0);await p.evaluate(()=>{document.querySelector('.pages-host').getAnimations()[0].currentTime=3200;});await p.waitForFunction(()=>ARCPlayer.getState().index===1);}
  else await p.waitForFunction(()=>ARCPlayer.getState().index===1&&!ARCPlayer.getState().transitioning);
  results.push({browser:name,file,mode,directionFrames:true,moves:true});
 }
 assert.deepEqual(errors,[]);results.push({browser:name,file,themeReplacement:true,sharedReplacement:true,sourceSwitch:true,undoReference:true,captionProvenance:true,saveReopen:true});await p.close();
 }
 }finally{await browser.close();}}
 if(process.env.DIRECTORY_PHOTO_REPORT)fs.writeFileSync(process.env.DIRECTORY_PHOTO_REPORT,JSON.stringify(results,null,2));console.log({photoVariants:results.filter(r=>r.themeReplacement).length,motionCases:results.filter(r=>r.directionFrames).length,pass:true});
}finally{if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});
