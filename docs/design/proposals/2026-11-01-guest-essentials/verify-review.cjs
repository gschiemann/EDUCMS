const {createRequire}=require('module');
const {pathToFileURL}=require('url');
const {chromium}=createRequire('/Users/gschiemann/Desktop/EDU CMS/package.json')('@playwright/test');
(async()=>{
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(pathToFileURL('/Users/gschiemann/Documents/Codex/2026-11-01/i-n/outputs/guest-essentials-review/index.html').href);
const wait=async(orientation)=>{
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===3);
  for(const frame of page.frames().slice(1)){
   await frame.waitForFunction(o=>window.__guestStudyReady===true&&document.querySelector('.stage').getAttribute('data-orient')===o,orientation);
   if(await frame.locator('.stage').getAttribute('data-orient')!==orientation)throw Error('Orientation did not update');
  }
};
await wait('landscape');
await page.getByRole('button',{name:'Portrait',exact:true}).click();
await wait('portrait');
await page.getByRole('button',{name:'Landscape',exact:true}).click();
await wait('landscape');
if(errors.length)throw Error(errors.join('\n'));
console.log('Review page: three previews load; Landscape → Portrait → Landscape updates all three; no page errors.');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
