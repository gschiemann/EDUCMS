const fs = require('fs');
let c = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');

function applyTheme(presetId, themeName) {
  const parts = c.split(presetId);
  if (parts.length < 2) { console.log('Could not find', presetId); return; }
  
  // Find the next 'zones: [' array
  const zonesIndex = parts[1].indexOf('zones: [');
  if (zonesIndex === -1) return;
  
  let braceCount = 1;
  let endZonesIndex = zonesIndex + 'zones: ['.length;
  while (braceCount > 0 && endZonesIndex < parts[1].length) {
    if (parts[1][endZonesIndex] === '[') braceCount++;
    if (parts[1][endZonesIndex] === ']') braceCount--;
    endZonesIndex++;
  }
  
  let zonesStr = parts[1].substring(zonesIndex, endZonesIndex);
  
  // Inject theme
  zonesStr = zonesStr.replace(/defaultConfig:\s*\{/g, "defaultConfig: { theme: '" + themeName + "',");
  
  parts[1] = parts[1].substring(0, zonesIndex) + zonesStr + parts[1].substring(endZonesIndex);
  c = parts.join(presetId);
}

applyTheme('preset-office-dashboard', 'office-dashboard');
applyTheme('gym-pe-display', 'gym-pe');
applyTheme('principals-office-welcome', 'principals-office');

fs.writeFileSync('apps/api/src/templates/system-presets.ts', c);
console.log('Applied themes');
