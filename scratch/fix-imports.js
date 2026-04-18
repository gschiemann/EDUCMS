const fs = require('fs');
const themes = [
  'stem-science', 'music-arts', 'library-quiet', 'bus-loop', 'gym-pe', 
  'middle-school-hall', 'high-school-athletics', 'office-dashboard', 'principals-office'
];
const p = 'apps/web/src/components/widgets/WidgetRenderer.tsx';
const c = fs.readFileSync(p, 'utf8');
const lines = c.split('\n');
const newLines = lines.filter(l => !themes.some(t => l.includes(`./themes/${t}`)));
fs.writeFileSync(p, newLines.join('\n'));
console.log(`Removed ${lines.length - newLines.length} imports`);
