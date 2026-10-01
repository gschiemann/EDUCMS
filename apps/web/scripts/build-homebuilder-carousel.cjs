const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'homebuilder-carousel.tsx')], bundle: true, minify: true,
  format: 'iife', target: ['chrome83', 'safari12'], jsx: 'automatic',
  supported: { destructuring: true },
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: path.join(__dirname, '../public/templates/_native-image-carousel.js'),
});
