const fs=require('node:fs');
const assert=require('node:assert/strict');
const {parsePdf}=require('./audit-evidence/compiled/pdf-parser.js');
const {buildTemplates}=require('./audit-evidence/compiled/import-builder.js');
(async()=>{
  const mixed=await parsePdf(fs.readFileSync('./audit-evidence/mixed-layout.pdf'));
  const built=buildTemplates(mixed,{resolveMedia:()=>null});
  assert.equal(mixed.pages.length,3);
  assert.equal(mixed.media.length,0);
  assert.equal(mixed.pages[1].zones.length,0);
  assert.deepEqual(built.map(p=>p.label),['Page 1','Page 3']);
  assert.ok(mixed.pages[0].zones.some(z=>z.defaultConfig.content==='Left column Right column'));
  const capped=await parsePdf(fs.readFileSync('./audit-evidence/forty-one-pages.pdf'));
  assert.equal(capped.pages.length,40);
  assert.equal(capped.warnings,undefined);
  const evidence={runtime:process.version,checksPassed:7,mixedSourcePages:3,parsedPages:mixed.pages.length,createdTemplateLabels:built.map(p=>p.label),zones:mixed.pages.map(p=>p.zones),mediaCount:mixed.media.length,cappedSourcePages:41,cappedParsedPages:capped.pages.length};
  fs.writeFileSync('./audit-evidence/pdf-runtime-results.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
