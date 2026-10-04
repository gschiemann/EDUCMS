const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('../apps/web/node_modules/@playwright/test');
const base=process.env.JLL_REVIEW_URL||'http://127.0.0.1:8929';
async function main(){
 const results=[];
 for(const [name,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch();
  try{
   for(const brand of ['jll','generic'])for(const variant of ['a','b','c']){
    const page=await browser.newPage({viewport:{width:1080,height:1920},hasTouch:true});
    await page.goto(`${base}/templates/custom/jll-touch-experiences/${brand}-${variant}.html?orientation=portrait&freeze=1`);
    await page.evaluate(()=>document.fonts.ready);
    const nav=await page.locator('.app-nav').boundingBox();
    assert.ok(nav.y>1920*.4&&nav.y+nav.height<1920*.56,'Navigation occupies the middle of the display');
    await page.locator('.app-nav [data-go="plans"]').tap();
    await page.locator('[data-floor="7"]').tap();
    await page.locator('[data-zoom="in"]').tap();
    assert.equal(await page.locator('[data-field="plans.zoom"]').textContent(),'150%');
    await page.locator('.app-nav [data-go="gallery"]').tap();
    await page.locator('.app-nav [data-back]').tap();
    assert.equal(await page.locator('[data-floor="7"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-field="plans.zoom"]').textContent(),'150%');
    await page.locator('.app-nav [data-go="home"]').tap();
    assert.equal(await page.locator('[data-page="home"]').isVisible(),true);
    assert.equal(await page.locator('[data-floor="0"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-field="plans.zoom"]').textContent(),'100%');
    assert.equal(await page.locator('.app-nav [data-back]').isDisabled(),true);
    assert.equal(await page.locator('.app-header [data-restart]').isVisible(),false);
    results.push({browser:name,brand,variant,pass:true,checks:['central navigation','touch taps','Back preserves selected floor and zoom','Home resets the experience']});
    await page.close();
   }
  }finally{await browser.close();}
 }
 fs.mkdirSync('/tmp/jll-portrait-reach',{recursive:true});
 fs.writeFileSync('/tmp/jll-portrait-reach/results.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({pass:true,cases:results.length}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
