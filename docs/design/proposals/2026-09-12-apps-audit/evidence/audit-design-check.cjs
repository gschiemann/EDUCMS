const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  const fragment=await fs.readFile('/Users/gschiemann/.codex/visualizations/2026/09/04/01a06ca4-5b44-7c10-9415-18660acaf603/apps-content-first.html','utf8');
  assert(!fragment.includes('APPS_AUDIT_QR_DATA'));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:736,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(fragment);
    assert.equal(await page.locator('.ap-item').count(),8);
    await page.getByRole('button',{name:'All sources',exact:true}).click();
    assert.equal(await page.locator('.ap-item').count(),11);
    await page.getByRole('button',{name:'Choose slide deck — Google Slides',exact:true}).click();
    assert(await page.getByRole('button',{name:'Add to canvas',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Use example',exact:true}).click();
    assert(await page.getByRole('button',{name:'Add example to canvas',exact:true}).isEnabled());
    await page.getByRole('button',{name:'Back to Apps',exact:false}).click();
    await page.getByRole('button',{name:'Recommended',exact:true}).click();
    await page.screenshot({path:'apps-design-desktop.png',fullPage:true});
    const widths=[];
    for(const width of [736,520,390,320]){
      await page.setViewportSize({width,height:1000});
      const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
      assert(!overflowing,'Horizontal overflow at '+width);
      widths.push({width,noHorizontalOverflow:true});
    }
    await page.screenshot({path:'apps-design-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Roadmap · 4 not yet available',exact:true}).click();
    assert.equal(await page.locator('[data-road]').count(),4);
    assert.equal(errors.length,0);
    const result={scope:'Design concept ONLY, not production CMS or provider testing',recommendedCards:8,allSources:11,roadmapEntries:4,exampleOnlyAddGate:true,widths,errors};
    await fs.writeFile('audit-design-results.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
