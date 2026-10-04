const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('../apps/web/node_modules/@playwright/test');
const root=path.resolve(__dirname,'../apps/web/public/templates');
const base=process.env.JLL_REVIEW_URL||'http://127.0.0.1:8929';
async function main(){
 const provenance=JSON.parse(fs.readFileSync(path.join(root,'_thumbs/poster-manifest.json')));
 const browser=await chromium.launch();
 try{
  for(const folder of ['jll-overview-directions','jll-touch-experiences'])for(const brand of ['jll','generic'])for(const direction of ['a','b','c']){
   const rel='custom/'+folder+'/'+brand+'-'+direction;
   for(const orientation of ['landscape','portrait']){
    const page=await browser.newPage({viewport:orientation==='portrait'?{width:720,height:1280}:{width:1280,height:720}});
    await page.goto(base+'/templates/'+rel+'.html?freeze=1&orientation='+orientation);
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-native-image-carousel] img')].filter(i=>i.offsetWidth).every(i=>i.complete&&i.naturalWidth>0));
    const file=path.join(root,'_thumbs',rel+(orientation==='portrait'?'-portrait':'')+'.png');
    fs.mkdirSync(path.dirname(file),{recursive:true});await page.screenshot({path:file,animations:'disabled'});await page.close();
   }
   provenance[rel]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel+'.html'))).digest('hex').slice(0,16);
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(root,'_thumbs/poster-manifest.json'),JSON.stringify(provenance,null,2)+'\n');
 console.log('24 current JLL/generic posters captured.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
