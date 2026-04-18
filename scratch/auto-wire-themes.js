const fs = require('fs');
const path = require('path');

// 1. First, make sure sunshine-academy.tsx exists
if (!fs.existsSync('apps/web/src/components/widgets/themes/sunshine-academy.tsx') && fs.existsSync('scratch/sunshine2.tsx')) {
  let src = fs.readFileSync('scratch/sunshine2.tsx', 'utf8');
  src = `import React, { useState, useEffect } from 'react';\nimport { CalendarDays, Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Wind, Droplets } from 'lucide-react';\n\n` + src;
  src = src.replace(/function SunshineAcademy/g, 'export function SunshineAcademy');
  fs.writeFileSync('apps/web/src/components/widgets/themes/sunshine-academy.tsx', src);
}

// 2. Parse all themes
const themesDir = 'apps/web/src/components/widgets/themes';
const files = fs.readdirSync(themesDir).filter(f => f.endsWith('.tsx') && !f.includes('registry'));

const themes = [];
for (const file of files) {
  const themeName = file.replace('.tsx', '');
  const content = fs.readFileSync(path.join(themesDir, file), 'utf8');
  
  const exports = [];
  const regex = /export function ([A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  
  if (exports.length > 0) {
    themes.push({ themeName, file, exports });
  }
}

// 3. Read WidgetRenderer
let renderer = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');

// 4. Inject imports
let importsStr = '\n// AUTO-GENERATED THEME IMPORTS\n';
for (const t of themes) {
  importsStr += `import { ${t.exports.join(', ')} } from './themes/${t.themeName}';\n`;
}

// We will insert imports at the top
renderer = renderer.replace(
  /\/\/ ═══════════════════════════════════════════════════════════════════════════\n\/\/ THEME SYSTEM/,
  importsStr + '\n// ═══════════════════════════════════════════════════════════════════════════\n// THEME SYSTEM'
);

// 5. Build injection mapping
const widgetMap = {
  'ClockWidget': ['Clock'],
  'WeatherWidget': ['Weather'],
  'CountdownWidget': ['Countdown'],
  'TextWidget': ['Text', 'RichText', 'Headline', 'Message'], // Map all text-like variants to TextWidget
  'AnnouncementWidget': ['Announcement'],
  'TickerWidget': ['Ticker'],
  'BellScheduleWidget': ['BellSchedule', 'Schedule'],
  'LunchMenuWidget': ['LunchMenu', 'Lunch'],
  'CalendarWidget': ['Calendar', 'Events'],
  'StaffSpotlightWidget': ['StaffSpotlight', 'Staff'],
  'ImageWidget': ['Image', 'Logo', 'Avatar'],
  'ImageCarouselWidget': ['ImageCarousel', 'Carousel', 'Photos'],
};

// Remove old static imports
renderer = renderer.replace(/import \{.*\} from '.\/themes\/(library-quiet|music-arts|stem-science)';\n/g, '');

for (const [widgetFunc, possibleSuffixes] of Object.entries(widgetMap)) {
  let cases = '';
  for (const t of themes) {
    for (const exp of t.exports) {
      for (const suffix of possibleSuffixes) {
        if (exp.endsWith(suffix) || exp === t.themeName.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('') + suffix) {
          cases += `  if (config.theme === '${t.themeName}') return <${exp} config={config} compact={compact} />;\n`;
          break; // Stop after first match for this theme
        }
      }
    }
  }

  // Inject into function body
  const searchStr = `function ${widgetFunc}({ config, compact }: { config: any; compact: boolean }) {`;
  const searchStr2 = `function ${widgetFunc}({ config }: { config: any }) {`;
  
  if (renderer.includes(searchStr)) {
    // If it doesn't take compact, remove compact from cases
    let adjustedCases = cases;
    renderer = renderer.replace(searchStr, searchStr + '\n' + adjustedCases);
  } else if (renderer.includes(searchStr2)) {
    let adjustedCases = cases.replace(/ compact=\{compact\}/g, '');
    renderer = renderer.replace(searchStr2, searchStr2 + '\n' + adjustedCases);
  }
}

// Clean up duplicate cases (from previous hardcoded ones)
// Actually, to be safe, we just let them ride, but maybe clean the LibraryQuiet ones
renderer = renderer.replace(/  if \(config.theme === '(library-quiet|music-arts|stem-science)'\) return <[a-zA-Z]+ config=\{config\}( compact=\{compact\})? \/>;\n/g, '');

fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', renderer);
console.log('Successfully wired up themes:', themes.map(t => t.themeName).join(', '));
