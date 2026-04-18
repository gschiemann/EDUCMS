const fs = require('fs');
const bg = fs.readFileSync('scratch/bg.svg', 'utf8');
const bg64 = Buffer.from(bg).toString('base64');
let data = fs.readFileSync('packages/database/seed-sunshine.js', 'utf8');
data = data.replace(/theme: 'integrated'/g, "theme: 'sunshine-academy'");
data = data.replace(/screenHeight: 2160,/, "screenHeight: 2160,\n    bgImage: 'url(\"data:image/svg+xml;base64," + bg64 + "\")',\n");
fs.writeFileSync('packages/database/seed-sunshine.js', data);
