/* ARC RIOT data contract + deterministic pagination. No layout content lives here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ARCCore=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const MODES=['flip','crossfade','slide','vertical-scroll','continuous-scroll'];
 const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
 function validateDataset(data){
  if(!data||typeof data.title!=='string'||!data.title.trim()||!Array.isArray(data.tenants))throw new Error('Dataset needs a title and a tenants array.');
  const ids=new Set();
  data.tenants.forEach((t,i)=>{
   if(!t||typeof t.id!=='string'||!t.id||ids.has(t.id))throw new Error(`Row ${i+1}: missing or duplicate id.`);ids.add(t.id);
   for(const k of ['name','suite'])if(typeof t[k]!=='string'||!t[k].trim())throw new Error(`Row ${i+1}: ${k} must be non-empty text.`);
   for(const k of ['floor','category'])if(t[k]!==undefined&&typeof t[k]!=='string')throw new Error(`Row ${i+1}: ${k} must be text.`);
   if(t.name.length>180||t.suite.length>16||(t.category||'').length>60||(t.floor||'').length>16)throw new Error(`Row ${i+1}: text exceeds the supported limit.`);
   if(t.active!==undefined&&typeof t.active!=='boolean')throw new Error(`Row ${i+1}: active must be true or false.`);
  });return data;
 }
 function sortTenants(tenants,sort){
  if(sort==='manual')return tenants.filter(t=>t.active!==false).slice();
  return tenants.filter(t=>t.active!==false).slice().sort((a,b)=>{
   if(sort==='floor')return collator.compare(a.floor||'',b.floor||'')||collator.compare(a.suite,b.suite)||collator.compare(a.name,b.name)||collator.compare(a.id,b.id);
   if(sort==='category')return collator.compare(a.category||'',b.category||'')||collator.compare(a.name,b.name)||collator.compare(a.id,b.id);
   return collator.compare(a.name,b.name)||collator.compare(a.suite,b.suite)||collator.compare(a.id,b.id);
  });
 }
 function paginate(tenants,capacity){if(!Number.isInteger(capacity)||capacity<1)throw new Error('Capacity must be a positive integer.');const pages=[];let page=[];for(const t of tenants){if(page.length&&(t.pageBreakBefore||page.length>=capacity)){pages.push(page);page=[];}page.push(t);}if(page.length)pages.push(page);return pages.length?pages:[[]];}
 function number(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
 function normalizeConfig(raw={}){
  return {...raw,autoplay:raw.autoplay!==false,paused:raw.paused===true,pageDurationMs:number(raw.pageDurationMs,14000,3000,120000),pageDurationsMs:Array.isArray(raw.pageDurationsMs)?raw.pageDurationsMs.map(n=>number(n,14000,3000,120000)):[],transitionMode:MODES.includes(raw.transitionMode)?raw.transitionMode:'crossfade',transitionDurationMs:number(raw.transitionDurationMs,900,100,3000),scrollSpeedPxPerSecond:number(raw.scrollSpeedPxPerSecond,44,10,200),scrollStartHoldMs:number(raw.scrollStartHoldMs,2500,0,30000),sort:['design','manual','name','floor','category'].includes(raw.sort)?raw.sort:'design'};
 }
 function dwell(config,index){return config.pageDurationsMs[index]||config.pageDurationMs;}
 return {MODES,validateDataset,sortTenants,paginate,normalizeConfig,dwell};
});
