const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('../../../apps/web/node_modules/@playwright/test');
const output = process.env.LAUNCH_EVIDENCE || '/Users/gschiemann/Desktop/template-flagship-audit/launch-final';
const base = process.env.LAUNCH_BASE || 'http://127.0.0.1:8768';
const files = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
function measure() {
  const stage = document.querySelector('.stage') || document.body;
  const scale = stage.getBoundingClientRect().width / (stage.offsetWidth || innerWidth);
  const visible = [...stage.querySelectorAll('[data-field]')].filter(e => !e.closest('[hidden]') && !e.querySelector('[data-field]') && e.textContent.trim() && e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden');
  const fields = visible.map(e => {
    const range = document.createRange(); range.selectNodeContents(e);
    const r = range.getBoundingClientRect();
    const owner = e.closest('article,section,header,footer') || stage;
    const p = owner.getBoundingClientRect();
    return { key: e.dataset.field, size: parseFloat(getComputedStyle(e).fontSize), floor: +(e.getAttribute('data-fit-min') || 50), box: { l:r.left,r:r.right,t:r.top,b:r.bottom }, outside: Math.max(p.left-r.left,r.right-p.right,p.top-r.top,r.bottom-p.bottom)/scale };
  });
  const collisions = [];
  for(let i=0;i<fields.length;i++) for(let j=i+1;j<fields.length;j++) { const a=fields[i].box,b=fields[j].box; if(Math.min(a.r,b.r)-Math.max(a.l,b.l)>3*scale && Math.min(a.b,b.b)-Math.max(a.t,b.t)>3*scale) collisions.push([fields[i].key,fields[j].key]); }
  return { fields:fields.length, min:Math.min(...fields.map(f=>f.size)), floors:fields.filter(f=>f.size+0.1<f.floor).map(f=>f.key), outside:fields.filter(f=>f.outside>4).map(f=>({key:f.key,px:Math.round(f.outside)})), collisions };
}
(async()=>{
  const results=[];
  for(const [engine,type] of Object.entries({chromium,webkit})) {
    const browser=await type.launch();
    for(const file of files) for(const orientation of ['landscape','portrait']) {
      const page=await browser.newPage({viewport:orientation==='landscape'?{width:1600,height:900}:{width:900,height:1600}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${base}/${file}?o=${orientation}`,{waitUntil:'load'});
      await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(800);
      const baseline=await page.evaluate(measure);
      const text=await page.evaluate(()=>[...document.querySelectorAll('[data-field]')].filter(e=>!e.closest('[hidden]')&&e.getBoundingClientRect().width&&!e.querySelector('[data-field]')&&e.textContent.trim().length>25).sort((a,b)=>b.textContent.length-a.textContent.length).slice(0,3).map(e=>({key:e.dataset.field,text:e.textContent.trim()})));
      await page.evaluate(text=>{const changed={};text.forEach(t=>changed[t.key]=t.text+' Please ask our team for help.');window.postMessage({type:'educms-overrides',text:changed},'*');},text);
      await page.waitForTimeout(500);const long=await page.evaluate(measure);
      const key=text[0]?.key;
      let saved=null;
      if(key){ await page.evaluate(({text,key})=>{const restored={};text.forEach(t=>restored[t.key]=t.text);window.postMessage({type:'educms-overrides',text:restored,textStyles:{[key]:{fontSize:64,fontFamily:'Georgia'}}},'*');},{text,key});await page.waitForTimeout(300);saved=await page.locator(`[data-field="${key}"]`).evaluate(e=>({size:getComputedStyle(e).fontSize,font:getComputedStyle(e).fontFamily})); }
      await page.screenshot({path:path.join(output,`${file.replace(/[/.]/g,'-')}-${engine}-${orientation}.png`)});
      results.push({file,engine,orientation,errors,baseline,long,saved}); await page.close();
    }
    await browser.close();
  }
  fs.writeFileSync(path.join(output,'geometry.json'),JSON.stringify(results,null,2));
  const issues=results.filter(r=>r.errors.length||r.baseline.collisions.length||r.baseline.outside.length||r.baseline.floors.length||r.long.collisions.length||r.long.outside.length||r.long.floors.length||r.saved&&(r.saved.size!=='64px'||!r.saved.font.includes('Georgia')));
  console.log(JSON.stringify({cases:results.length,issues:issues.map(r=>({file:r.file,engine:r.engine,orientation:r.orientation,baseline:r.baseline,long:r.long,saved:r.saved}))},null,2));
  process.exitCode=issues.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
