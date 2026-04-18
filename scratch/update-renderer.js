const fs = require('fs');

let c = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');

const importsBlock = `
import { LibraryQuietText, LibraryQuietClock, LibraryQuietImage, LibraryQuietRichText, LibraryQuietLunch, LibraryQuietTicker } from './themes/library-quiet';
import { MusicArtsText, MusicArtsCountdown, MusicArtsRichText, MusicArtsSpotlight, MusicArtsTicker } from './themes/music-arts';
import { StemScienceText, StemScienceCountdown, StemScienceRichText, StemScienceImageCarousel, StemScienceTicker } from './themes/stem-science';
`;

// Insert imports below lucide-react
c = c.replace(
  /} from 'lucide-react';/,
  "} from 'lucide-react';\n" + importsBlock
);

// Inject into widgets
c = c.replace(
  'function ClockWidget({ config, compact }: { config: any; compact: boolean }) {',
  "function ClockWidget({ config, compact }: { config: any; compact: boolean }) {\n  if (config.theme === 'library-quiet') return <LibraryQuietClock config={config} />;"
);

c = c.replace(
  'function CountdownWidget({ config, compact }: { config: any; compact: boolean }) {',
  "function CountdownWidget({ config, compact }: { config: any; compact: boolean }) {\n  if (config.theme === 'music-arts') return <MusicArtsCountdown config={config} />;\n  if (config.theme === 'stem-science') return <StemScienceCountdown config={config} />;"
);

c = c.replace(
  'function TextWidget({ config }: { config: any }) {',
  "function TextWidget({ config }: { config: any }) {\n  if (config.theme === 'library-quiet') return <LibraryQuietText config={config} />;\n  if (config.theme === 'music-arts') return <MusicArtsText config={config} />;\n  if (config.theme === 'stem-science') return <StemScienceText config={config} />;\n  if (config.html && config.theme === 'library-quiet') return <LibraryQuietRichText config={config} />;\n  if (config.html && config.theme === 'music-arts') return <MusicArtsRichText config={config} />;\n  if (config.html && config.theme === 'stem-science') return <StemScienceRichText config={config} />;"
);

c = c.replace(
  'function LunchMenuWidget({ config, compact }: { config: any; compact: boolean }) {',
  "function LunchMenuWidget({ config, compact }: { config: any; compact: boolean }) {\n  if (config.theme === 'library-quiet') return <LibraryQuietLunch config={config} />;"
);

c = c.replace(
  'function StaffSpotlightWidget({ config, compact }: { config: any; compact: boolean }) {',
  "function StaffSpotlightWidget({ config, compact }: { config: any; compact: boolean }) {\n  if (config.theme === 'music-arts') return <MusicArtsSpotlight config={config} />;"
);

c = c.replace(
  'function ImageWidget({ config }: { config: any }) {',
  "function ImageWidget({ config }: { config: any }) {\n  if (config.theme === 'library-quiet') return <LibraryQuietImage config={config} />;"
);

c = c.replace(
  'function ImageCarouselWidget({ config }: { config: any }) {',
  "function ImageCarouselWidget({ config }: { config: any }) {\n  if (config.theme === 'stem-science') return <StemScienceImageCarousel config={config} />;"
);

c = c.replace(
  'function TickerWidget({ config }: { config: any }) {',
  "function TickerWidget({ config }: { config: any }) {\n  if (config.theme === 'library-quiet') return <LibraryQuietTicker config={config} />;\n  if (config.theme === 'music-arts') return <MusicArtsTicker config={config} />;\n  if (config.theme === 'stem-science') return <StemScienceTicker config={config} />;"
);

fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', c);
console.log('done');
