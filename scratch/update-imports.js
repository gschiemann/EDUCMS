const fs = require('fs');

let c = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');

const injectImports = `
import { LibraryQuietText, LibraryQuietClock, LibraryQuietImage, LibraryQuietRichText, LibraryQuietLunch, LibraryQuietTicker } from './themes/library-quiet';
import { MusicArtsText, MusicArtsCountdown, MusicArtsRichText, MusicArtsSpotlight, MusicArtsTicker } from './themes/music-arts';
import { StemScienceText, StemScienceCountdown, StemScienceRichText, StemScienceImageCarousel, StemScienceTicker } from './themes/stem-science';
`;

if (!c.includes('LibraryQuietClock')) {
  c = c.replace(
    /import \{\s+BusLoopText,\s+BusLoopClock,[\s\S]*?from '\.\/themes\/bus-loop';/,
    (match) => match + '\n' + injectImports
  );
  fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', c);
  console.log('imports injected');
} else {
  // If LibraryQuietClock is already in the file (e.g. inside a component), we just forcefully inject at the top after bus-loop
  if (!c.includes("import { LibraryQuietText")) {
    c = c.replace(
      /from '\.\/themes\/bus-loop';/,
      "from './themes/bus-loop';\n" + injectImports
    );
    fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', c);
    console.log('imports injected forcefully');
  }
}
