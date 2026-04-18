const fs = require('fs');
const prefixes = ['MSHall', 'StemScience', 'LibraryQuiet', 'GymPE', 'Athletics', 'PrincipalsOffice', 'OfficeDashboard', 'BusLoop', 'MusicArts'];
const p = 'apps/web/src/components/widgets/variants-register.ts';
const c = fs.readFileSync(p, 'utf8');
const lines = c.split('\n');
const newLines = lines.filter(l => !prefixes.some(pre => l.includes(pre)));
fs.writeFileSync(p, newLines.join('\n'));
console.log(`Removed ${lines.length - newLines.length} variable lines`);
