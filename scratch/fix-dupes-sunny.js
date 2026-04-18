const fs = require('fs');
let c = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');

c = c.replace(/theme: 'sunny-meadow',([^}]*?)theme: 'sunny-meadow',/g, "theme: 'sunny-meadow',$1");

fs.writeFileSync('apps/api/src/templates/system-presets.ts', c);
