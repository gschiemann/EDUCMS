const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const {chromium,webkit} = require('@playwright/test');
const out=process.env.TEMPLATE_TEST_OUTPUT||path.resolve('test-results/template-layout');
fs.mkdirSync(out,{recursive:true});
const designs=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../scripts/essentials-catalog.json'))).map(x=>x.url).concat(['/templates/signage/real-estate/01-availability-flagship.html','/templates/signage/museum/01-today-flagship.html','/templates/signage/bar/09-hours-location.html']);
(async()=>{
 const results=[];
 for(const [engine,kind] of Object.entries({chromium,webkit})){
  const browser=await kind.launch({headless:true});
  for(const name of designs)for(const orientation of ['landscape','portrait']){
   const page=await browser.newPage({viewport:orientation==='landscape'?{width:1920,height:1080}:{width:1080,height:1920},deviceScaleFactor:1});
   await page.route((url)=>!['localhost','127.0.0.1'].includes(url.hostname),r=>r.abort());
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto((process.env.TEMPLATE_TEST_URL||'http://127.0.0.1:8917')+name+'?o='+orientation);
   await page.waitForFunction(()=>window.__essentialsReady===true && [...document.fonts].filter(x=>x.status==='loading').length===0);
   await page.waitForTimeout(300);
   if(process.env.TEMPLATE_LONG_COPY==='1') {
    const key=name.includes('/essentials/')?'hero.title':'brand.name';
    const text=name.includes('/essentials/')?'A little guidance.\nA warmer welcome.':'The Alder House Collection';
    await page.evaluate(({key,text})=>window.postMessage({type:'educms-overrides',text:{[key]:text}},'*'),{key,text});
    await page.waitForTimeout(200);
   }
   await page.screenshot({path:path.join(out,name.replace('/templates/signage/','').replace(/\//g,'-').replace('.html','')+'-'+orientation+'-'+engine+'.png')});
   const geometry=await page.evaluate(()=>{
    const stage=document.querySelector('.stage'),s=stage.getBoundingClientRect();
    const fields=[...stage.querySelectorAll('[data-field]')].filter(el=>el.getBoundingClientRect().width&&getComputedStyle(el).visibility!=='hidden');
    const textBounds=fields.map(el=>{let range=document.createRange();range.selectNodeContents(el);const t=range.getBoundingClientRect(),r=el.getBoundingClientRect(),style=getComputedStyle(el);return {key:el.dataset.field,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},text:{x:t.x,y:t.y,right:t.right,bottom:t.bottom,width:t.width,height:t.height},font:parseFloat(style.fontSize),floor:Number(el.dataset.fitMin),scroll:el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2,within:t.left>=r.left-2&&t.right<=r.right+2&&t.top>=r.top-3&&t.bottom<=r.bottom+3,withinParent:(()=>{const p=el.parentElement.getBoundingClientRect();return t.left>=p.left-2&&t.right<=p.right+2&&t.top>=p.top-3&&t.bottom<=p.bottom+3})(),onStage:t.left>=s.left-2&&t.right<=s.right+2&&t.top>=s.top-2&&t.bottom<=s.bottom+2};});
    const collisions=[];for(let i=0;i<textBounds.length;i++)for(let j=i+1;j<textBounds.length;j++){let a=textBounds[i],b=textBounds[j];if(Math.min(a.text.right,b.text.right)-Math.max(a.text.x,b.text.x)>4&&Math.min(a.text.bottom,b.text.bottom)-Math.max(a.text.y,b.text.y)>4)collisions.push([a.key,b.key]);}
    return {fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),fields:textBounds.length,minFont:Math.min(...textBounds.map(x=>x.font)),violations:textBounds.filter(x=>x.scroll||!x.within||!x.withinParent||!x.onStage||x.font<x.floor),collisions};
   });
   results.push({engine,name,orientation,errors,...geometry});
   console.log(JSON.stringify({engine,name,orientation,errors,fields:geometry.fields,minFont:geometry.minFont,violations:geometry.violations.map(x=>({key:x.key,scroll:x.scroll,within:x.within,onStage:x.onStage})),collisions:geometry.collisions}));
   await page.close();
  }
  await browser.close();
 }
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(results,null,2));
 if(results.some(r=>r.errors.length||r.violations.length||r.collisions.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
