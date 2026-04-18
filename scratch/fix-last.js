const fs = require('fs');

let c = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');

// 1. Export weather utils
c = c.replace('async function fetchWeather(', 'export async function fetchWeather(');
c = c.replace('function getWMO(', 'export function getWMO(');

// 2. Fix the import
c = c.replace('import { GymPEText, GymPEWeather, GymPECalendar, GymPEAnnouncement, GymPETicker } from \\'./themes/gym-pe\\';', 'import { GymPEText, GymPEWeather, GymPEBellSchedule, GymPEAnnouncement, GymPETicker } from \\'./themes/gym-pe\\';');

// 3. Remove GymPECalendar from CalendarWidget
c = c.replace('  if (config.theme === \\'gym-pe\\') return <GymPECalendar config={config} compact={compact} />;\\n', '');
c = c.replace('  if (config.theme === \\'gym-pe\\') return <GymPECalendar config={config} />;\\n', '');

// 4. Add GymPEBellSchedule to BellScheduleWidget
const bellSearch = 'function BellScheduleWidget({ config, compact }: { config: any; compact: boolean }) {';
if (c.includes(bellSearch) && !c.includes('GymPEBellSchedule')) {
  c = c.replace(bellSearch, bellSearch + '\\n  if (config.theme === \\'gym-pe\\') return <GymPEBellSchedule config={config} compact={compact} />;');
}

fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', c);
console.log('Fixed last issues!');
