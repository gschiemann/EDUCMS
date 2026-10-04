const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('../apps/web/node_modules/@playwright/test');
const base=process.env.JLL_REVIEW_URL||'http://127.0.0.1:8929';
async function main(){
 const results=[];
 for(const [name,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch();
  try{
   const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/index.html');
   const frame=await page.locator('.after-frame').elementHandle().then(e=>e.contentFrame());
   await frame.waitForSelector('.app-nav');
   await frame.locator('.app-nav [data-go="plans"]').click();
   await frame.locator('[data-floor="7"]').click();
   await page.locator('[data-full]').click();
   assert.equal(await frame.locator('[data-floor="7"]').getAttribute('aria-pressed'),'true');
   assert.equal(await frame.locator('[data-page="plans"]').isVisible(),true);
   await page.screenshot({path:'/tmp/jll-review-full-plans-'+name+'.png',animations:'disabled'});
   await page.locator('[data-close]').click();
   assert.equal(await frame.locator('[data-floor="7"]').getAttribute('aria-pressed'),'true');
   await frame.locator('.app-nav [data-go="gallery"]').click();
   await frame.locator('[data-back]:visible').click();
   assert.equal(await frame.locator('[data-floor="7"]').getAttribute('aria-pressed'),'true');
   await page.locator('[data-compare]').click();assert.equal(await page.locator('.before').isVisible(),true);
   await page.locator('[data-compare]').click();assert.equal(await page.locator('.before').isVisible(),false);
   await page.locator('[data-brand="generic"]').click();
   await page.locator('[data-orientation="portrait"]').click();
   await page.locator('[data-direction="c"]').click();
   assert.match(await page.locator('.after-frame').getAttribute('src'),/generic-c.html\?orientation=portrait/);
   await page.locator('[data-family="signage"]').click();
   assert.match(await page.locator('.after-frame').getAttribute('src'),/jll-overview-directions/);
   assert.deepEqual(errors,[]);
   results.push({browser:name,pass:true,checks:['fullscreen preserves page and floor','Back preserves floor','comparison','brand direction orientation and family selectors']});
  }finally{await browser.close();}
 }
 fs.writeFileSync('/tmp/jll-review-controls-results.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({pass:true,browsers:results.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
