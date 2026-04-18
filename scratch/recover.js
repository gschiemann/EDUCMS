const fs = require('fs');
const path = require('path');

const THEMES_DIR = 'apps/web/src/components/widgets/themes';
const RENDERER_PATH = 'apps/web/src/components/widgets/WidgetRenderer.tsx';

let rendererCode = fs.readFileSync(RENDERER_PATH, 'utf8');

// 1. We will dynamically find all exported functions from the theme files
const themeFiles = fs.readdirSync(THEMES_DIR).filter(f => f.endsWith('.tsx'));
const allExports = {};

for (const file of themeFiles) {
  const content = fs.readFileSync(path.join(THEMES_DIR, file), 'utf8');
  const exports = [];
  const regex = /export function ([A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  allExports[file.replace('.tsx', '')] = exports;
}

// 2. Generate the imports block
let importsBlock = '';
for (const [theme, exports] of Object.entries(allExports)) {
  if (exports.length > 0) {
    importsBlock += `import { ${exports.join(', ')} } from './themes/${theme}';\n`;
  }
}

// Ensure lucide-react import exists
if (!rendererCode.includes('lucide-react')) {
  // Just in case it's missing entirely (but it shouldn't be)
}

// Inject imports below lucide-react
rendererCode = rendererCode.replace(
  /} from 'lucide-react';/,
  "} from 'lucide-react';\n\n" + importsBlock
);

// 3. Define how to map widget types to component name patterns
const widgetMappings = [
  { type: 'ClockWidget', patterns: ['Clock'] },
  { type: 'WeatherWidget', patterns: ['Weather'] },
  { type: 'CountdownWidget', patterns: ['Countdown'] },
  { type: 'TextWidget', patterns: ['Text', 'RichText'] },
  { type: 'AnnouncementWidget', patterns: ['Announcement'] },
  { type: 'TickerWidget', patterns: ['Ticker'] },
  { type: 'BellScheduleWidget', patterns: ['BellSchedule'] },
  { type: 'LunchMenuWidget', patterns: ['Lunch', 'LunchMenu'] },
  { type: 'CalendarWidget', patterns: ['Calendar'] },
  { type: 'StaffSpotlightWidget', patterns: ['Staff', 'Spotlight'] },
  { type: 'ImageCarouselWidget', patterns: ['ImageCarousel', 'Carousel'] },
  { type: 'ImageWidget', patterns: ['Image'] },
  { type: 'LogoWidget', patterns: ['Logo'] }
];

// Helper to find which theme matches which component
function getInjectionsForWidget(widgetType) {
  let lines = [];
  const mapping = widgetMappings.find(m => m.type === widgetType);
  if (!mapping) return lines;

  for (const [theme, exports] of Object.entries(allExports)) {
    // Theme name in config is usually the filename, e.g. 'library-quiet'
    
    for (const exp of exports) {
      if (mapping.patterns.some(p => exp.includes(p))) {
        // Special case for RichText
        if (exp.includes('RichText')) {
          lines.push(`  if (config.html && config.theme === '${theme}') return <${exp} config={config} />;`);
        } else {
          // Normal case
          let configPass = "config={config}";
          // If the target widget accepts compact, we should pass it, but theme widgets mostly take {config}
          // We will just pass config={config}.
          // Check original widget renderer to see if it needs compact. Some do:
          if (['SunnyMeadowClock', 'SunshineAcademyClock', 'SunnyMeadowAnnouncement', 'SunnyMeadowWeather', 'SunnyMeadowLunchMenu'].includes(exp)) {
             configPass = "config={config} compact={compact}";
          }
          lines.push(`  if (config.theme === '${theme}') return <${exp} ${configPass} />;`);
        }
      }
    }
  }
  return lines;
}

// 4. Inject into each widget function
for (const mapping of widgetMappings) {
  const widgetFn = mapping.type;
  const regex = new RegExp(`function ${widgetFn}\\([^)]+\\) \\{`);
  const match = regex.exec(rendererCode);
  if (match) {
    const injections = getInjectionsForWidget(widgetFn).join('\n');
    if (injections) {
      // Find the first opening brace and inject right after
      const index = match.index;
      const braceIndex = rendererCode.indexOf('{', index);
      rendererCode = rendererCode.substring(0, braceIndex + 1) + '\n' + injections + rendererCode.substring(braceIndex + 1);
    }
  }
}

// Add the variant logic to WidgetPreview that was also lost
if (!rendererCode.includes('import { getVariant }')) {
  rendererCode = rendererCode.replace(
    /export function WidgetPreview/,
    "import './variants-register';\nimport { getVariant } from './variants';\n\nexport function WidgetPreview"
  );
  
  rendererCode = rendererCode.replace(
    /const compact = height < 20 \|\| width < 25;/,
    "const compact = height < 20 || width < 25;\n\n  if (cfg.variant) {\n    const v = getVariant(cfg.variant);\n    if (v) {\n      const R = v.render as any;\n      return <R config={cfg} compact={compact} live={live} onConfigChange={onConfigChange} />;\n    }\n  }"
  );
  
  // also the signature of WidgetPreview changed to add onConfigChange
  rendererCode = rendererCode.replace(
    /export function WidgetPreview\(\{ widgetType, config, width, height, live \}: \{/,
    "export function WidgetPreview({ widgetType, config, width, height, live, onConfigChange }: {\n  widgetType: string;\n  config: any;\n  width: number;\n  height: number;\n  live?: boolean;\n  onConfigChange?: (patch: Record<string, any>) => void;"
  );
  
  // also add the argument
  rendererCode = rendererCode.replace(
    /live\?: boolean;  \/\/ true on the player page.*?/,
    "live?: boolean;\n  onConfigChange?: (patch: Record<string, any>) => void;\n"
  );
}

fs.writeFileSync(RENDERER_PATH, rendererCode);
console.log('Automated recovery and injection complete!');
