// Read-only reproduction of the current screen exclusion using repository code.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
require.extensions['.ts'] = function (module, filename) {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(js, filename);
};
const { nativeVideoEnrolled } = require(path.join(root, 'apps/api/src/screens/native-video.ts'));
const id = '13eb0b62-d420-4517-922e-e17700716fae';
(async () => {
  for (const [rollout, expected] of [
    ['all', true],
    [`all,-${id}`, false],
    [`${id},-${id}`, false],
    [`faces,model:generic-android,-${id}`, false],
  ]) {
    const enrolled = await nativeVideoEnrolled({id, hardwareModel:'generic-android'}, async()=>true, {PLAYER_NATIVE_VIDEO:rollout});
    assert.equal(enrolled, expected);
    console.log(JSON.stringify({rollout,enrolled}));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
