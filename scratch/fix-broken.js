const fs = require('fs');

let c = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');

c = c.replace(/<GymPE \/>/g, '<GymPEWeather config={config} />');
// Wait, GymPEWeather is in WeatherWidget.
// Let's just restore them correctly!
