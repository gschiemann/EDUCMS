const fs = require('fs');
const bg = fs.readFileSync('scratch/bg.svg', 'utf8');
const bg64 = Buffer.from(bg).toString('base64');
let data = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');
const searchStr = "screenHeight: 2160,\r\n      zones: [\r\n        { name: 'Welcome Headline'";
const searchStr2 = "screenHeight: 2160,\n      zones: [\n        { name: 'Welcome Headline'";
const replaceStr = "screenHeight: 2160,\n      bgImage: 'url(\"data:image/svg+xml;base64," + bg64 + "\")',\n      zones: [\n        { name: 'Welcome Headline'";
data = data.replace(searchStr, replaceStr).replace(searchStr2, replaceStr);
fs.writeFileSync('apps/api/src/templates/system-presets.ts', data);
