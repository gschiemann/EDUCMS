const fs = require('fs');
let c = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');

// Regex to remove the second theme if it's the exact same string
// E.g., `theme: 'sunshine-academy', format: '12h', theme: 'sunshine-academy'`
// We'll just look for any duplicate keys within the same `{ ... }` block
c = c.replace(/({[^}]*?)theme:\s*'([^']+)'(.*?)theme:\s*'\2'([^}]*?})/g, "$1theme: '$2'$3$4");

// But what if they have DIFFERENT themes? E.g., `theme: 'library-quiet', format: '12h', theme: 'sunshine-academy'`
// My `fix-presets.js` prepended `theme: '...'`. So the FIRST one is correct. We should delete any subsequent `theme: '...'` in that block.
c = c.replace(/(theme:\s*'[^']+',[^}]*?)theme:\s*'[^']+'/g, "$1");

fs.writeFileSync('apps/api/src/templates/system-presets.ts', c);
