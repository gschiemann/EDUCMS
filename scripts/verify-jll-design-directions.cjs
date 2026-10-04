/* Real sandbox render + editor-contract checks for the three review directions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('../apps/web/node_modules/@playwright/test');
const base = process.env.JLL_REVIEW_URL || 'http://127.0.0.1:8928';
const output = process.env.JLL_REVIEW_PROOF || '/tmp/jll-directions-proof';
fs.mkdirSync(output, { recursive: true });
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function send(page, data) {
  await page.evaluate(d => document.querySelector('iframe').contentWindow.postMessage(d, '*'), data);
  await page.waitForTimeout(150);
}
async function main() {
  const results = [];
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      for (const brand of ['jll', 'generic']) for (const direction of ['a', 'b', 'c']) for (const orientation of ['landscape', 'portrait']) {
        const id = `${engineName}-${brand}-${direction}-${orientation}`;
        const page = await browser.newPage({ viewport: orientation === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const url = `${base}/templates/custom/jll-overview-directions/${brand}-${direction}.html?orientation=${orientation}&text=${enc({'carousel.autoplay':'no'})}`;
        await page.setContent(`<style>body{margin:0}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" title="Review candidate" src="${url}"></iframe><script>window.messages=[];addEventListener('message',e=>window.messages.push(e.data));</script>`);
        const frame = page.frames().find(f => f !== page.mainFrame());
        await frame.waitForSelector('[data-native-image-carousel]');
        await frame.evaluate(() => document.fonts.ready);
        await frame.waitForFunction(() => Array.from(document.querySelectorAll('[data-native-image-carousel] img')).every(i => i.complete && i.naturalWidth > 0));
        await page.waitForTimeout(150);
        const proof = await frame.evaluate(() => {
          const stage = document.querySelector('.stage').getBoundingClientRect();
          const visible = Array.from(document.querySelectorAll('.stage [data-field]')).filter(e => e.offsetWidth && e.offsetHeight);
          const fields = visible.map(e => {
            const r=e.getBoundingClientRect(), style=getComputedStyle(e);
            return {key:e.dataset.field,fontPx1080:parseFloat(style.fontSize)/2,clipped:e.scrollWidth>e.clientWidth+2,outside:r.left<stage.left-1||r.right>stage.right+1||r.top<stage.top-1||r.bottom>stage.bottom-20};
          });
          return {origin:self.origin,fields,logoContained:Array.from(document.querySelectorAll('[data-imgslot="brand.logo"] img')).every(e=>getComputedStyle(e).objectFit==='contain')};
        });
        assert.equal(proof.origin,'null',id+' iframe sandbox');
        assert.deepEqual(proof.fields.filter(f=>f.fontPx1080<48||f.clipped||f.outside),[],id+' type size / edges');
        assert.equal(proof.logoContained,true,id+' logo containment');
        assert.deepEqual(errors,[],id+' browser errors');
        await page.screenshot({path:path.join(output,id+'.png')});
        await send(page,{type:'educms-overrides',text:{'property.name':'Harbor\nExchange','property.address':'100 Waterfront Avenue','highlights.0.value':'24,000','theme.brand':'#124c49','theme.fDisplay':'Georgia','media.property.hero.fit':'contain','media.property.hero.position':'left top'},textStyles:{'property.address':{fontSize:112,bold:true,italic:true,offsetX:16,offsetY:12}}});
        assert.equal(await frame.locator('[data-field="property.name"]').textContent(),'Harbor\nExchange');
        assert.equal(await frame.locator('[data-field="highlights.0.value"]').textContent(),'24,000');
        assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()),'#124c49');
        assert.equal(await frame.locator('[data-field="property.name"]').evaluate(e=>getComputedStyle(e).fontFamily.includes('Georgia')),true,id+' display font');
        assert.equal(await frame.locator('[data-field="property.address"]').evaluate(e=>e.style.transform.includes('16px')&&e.style.transform.includes('12px')&&getComputedStyle(e).fontStyle==='italic'&&Number(getComputedStyle(e).fontWeight)>=700),true,id+' text styles and saved position');
        assert.equal(await frame.locator('[data-imgslot="property.hero"] img').first().evaluate(e=>getComputedStyle(e).objectFit),'contain',id+' image fit');
        await send(page,{type:'educms-layout-request'});
        assert.equal(await page.evaluate(()=>window.messages.some(m=>m.type==='educms-layout-ready'&&m.keys.includes('property.name'))),true,id+' layout editor registration');
        await send(page,{type:'educms-edit-mode',on:true});
        await frame.locator('[data-field="property.name"]').click();
        await page.waitForFunction(()=>window.messages.some(m=>m.type==='educms-field-click'&&m.key==='property.name'));
        await send(page,{type:'educms-overrides',text:{'media.property.hero.slides':JSON.stringify([base+'/templates/signage/corporate/commercial-real-estate/_assets/lobby.jpg']),'media.property.hero.mode':'single'}});
        await frame.waitForFunction(()=>document.querySelector('[data-imgslot="property.hero"] img')?.src.includes('lobby.jpg'));
        assert.deepEqual(errors,[],id+' editor browser errors');
        results.push({id,pass:true,...proof,editor:'copy, facts, theme color/font, text style/position, layout tools, click-to-edit, media replacement and fit'});
        await page.close();
      }
      if(process.env.JLL_SKIP_REVIEW_CONTROLS)continue;
      const page=await browser.newPage({viewport:{width:1600,height:1100}});
      await page.goto(base+'/index.html');
      for(const direction of ['a','b','c']) {
        await page.locator('[data-direction="'+direction+'"]').click();
        assert.match(await page.locator('#after').getAttribute('src'),new RegExp('jll-'+direction));
      }
      await page.locator('[data-brand="generic"]').click();
      await page.locator('[data-orientation="portrait"]').click();
      await page.locator('[data-full]').click();
      assert.equal(await page.locator('.full').isVisible(),true);
      assert.match(await page.locator('.full iframe').getAttribute('src'),/generic-c.*portrait/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.full').isVisible(),false);
      assert.equal(await page.locator('[data-full]').evaluate(e=>document.activeElement===e),true);
      results.push({id:engineName+'-review-controls',pass:true});
      await page.close();
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({pass:true,cases:results.length,output}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
